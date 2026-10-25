import { and, asc, eq, ilike, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { roadmapItems, type RoadmapLinks } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import { SCHOOL } from "@/lib/config";

// The roadmap site is a static app that loads one roadmap.json; everything we
// need (titles, themes, links between items) is in there. No AI involved.

const EXPORTED_KEY = "school_roadmap_exported_at";

export type RoadmapItem = typeof roadmapItems.$inferSelect;
export type SchoolStatus = "todo" | "bezig" | "klaar" | "in_portflow";
export const STATUSES: SchoolStatus[] = ["todo", "bezig", "klaar", "in_portflow"];
// Side quests and products go into Portflow; the rest is context.
export const TRACKED_KINDS = ["side", "product"];

export const isStatus = (s: unknown): s is SchoolStatus => STATUSES.includes(s as SchoolStatus);

type RoadmapJson = {
  exported_at: string;
  outcomes: { id: string; code: string; title: string; criteria: { label: string; description: string }[] }[];
  assignments: { id: string; kind: string; title: string; desc: string; products: string[]; outcomes: string[]; knowledge: string[] }[];
  products: { id: string; title: string; desc: string; outcomes: string[]; knowledge: string[] }[];
  knowledge: { id: string; title: string; desc: string }[];
  canvas: { positions: Record<string, { container_id: string | null }>; containers: { id: string; title: string }[] };
};

/** Fetches roadmap.json and upserts it; skipped when the export didn't change (unless forced). */
export async function syncRoadmap(force = false) {
  const res = await fetch(new URL("roadmap.json", SCHOOL.roadmapUrl), { cache: "no-store" });
  if (!res.ok) throw new Error(`roadmap.json: HTTP ${res.status}`);
  const data = (await res.json()) as RoadmapJson;
  if (!force && (await getSetting<string>(EXPORTED_KEY)) === data.exported_at) return { changed: false, items: 0 };

  const containers = new Map(data.canvas.containers.map((c) => [c.id, c.title]));
  const theme = (id: string) => containers.get(data.canvas.positions[id]?.container_id ?? "") ?? null;
  type Row = Pick<RoadmapItem, "id" | "kind" | "title" | "code" | "theme" | "description" | "links" | "position">;
  const rows: Row[] = [
    ...data.outcomes.map((o) => ({
      id: o.id,
      kind: "outcome",
      title: o.title,
      code: o.code,
      theme: null,
      description: o.criteria.map((c) => `${c.label}. ${c.description}`).join("\n"),
      links: {},
    })),
    ...data.assignments.map((a) => ({
      id: a.id,
      kind: a.kind === "side" ? "side" : "assignment",
      title: a.title,
      code: null,
      theme: theme(a.id),
      description: a.desc ?? "",
      links: { products: a.products, outcomes: a.outcomes, knowledge: a.knowledge } satisfies RoadmapLinks,
    })),
    ...data.products.map((p) => ({
      id: p.id,
      kind: "product",
      title: p.title,
      code: null,
      theme: theme(p.id),
      description: p.desc ?? "",
      links: { outcomes: p.outcomes, knowledge: p.knowledge } satisfies RoadmapLinks,
    })),
    ...data.knowledge.map((k) => ({ id: k.id, kind: "knowledge", title: k.title, code: null, theme: null, description: k.desc ?? "", links: {} })),
  ].map((r, position) => ({ ...r, position }));

  await db.transaction(async (tx) => {
    for (const row of rows) {
      // Only the roadmap's own fields; Piet's status, evidence and match words stay.
      const { kind, title, code, theme, description, links, position } = row;
      await tx
        .insert(roadmapItems)
        .values({ ...row, syncedAt: new Date() })
        .onConflictDoUpdate({
          target: roadmapItems.id,
          set: { kind, title, code, theme, description, links, position, syncedAt: new Date() },
        });
    }
    // Gone from the roadmap: drop it, unless Piet already did something with it.
    await tx
      .delete(roadmapItems)
      .where(
        and(
          notInArray(roadmapItems.id, rows.map((r) => r.id)),
          eq(roadmapItems.status, "todo"),
          isNull(roadmapItems.evidenceUrl),
          isNull(roadmapItems.note)
        )
      );
  });
  await setSetting(EXPORTED_KEY, data.exported_at);
  console.log(`[school] roadmap synced: ${rows.length} items (export ${data.exported_at})`);
  return { changed: true, items: rows.length };
}

export async function listRoadmap() {
  return db.select().from(roadmapItems).orderBy(asc(roadmapItems.position));
}

export async function listTracked() {
  return db.select().from(roadmapItems).where(inArray(roadmapItems.kind, TRACKED_KINDS)).orderBy(asc(roadmapItems.position));
}

/**
 * A side quest or product by (part of) its title. An exact title wins; with
 * several partial matches the caller gets them all to ask which one.
 */
export async function findSchoolItem(query: string): Promise<{ item: RoadmapItem | null; candidates: RoadmapItem[] }> {
  const q = query.trim();
  if (!q) return { item: null, candidates: [] };
  const rows = await db
    .select()
    .from(roadmapItems)
    .where(and(inArray(roadmapItems.kind, TRACKED_KINDS), ilike(roadmapItems.title, `%${q}%`)))
    .orderBy(asc(roadmapItems.position));
  const exact = rows.find((r) => r.title.toLowerCase() === q.toLowerCase());
  return { item: exact ?? (rows.length === 1 ? rows[0] : null), candidates: rows };
}

export async function updateSchoolItem(
  id: string,
  changes: { status?: SchoolStatus; evidenceUrl?: string | null; note?: string | null; match?: string[] },
  source: "manual" | "gitlab" = "manual"
) {
  const set: Partial<RoadmapItem> = {};
  if (changes.status) Object.assign(set, { status: changes.status, statusSource: source, statusAt: new Date() });
  if (changes.evidenceUrl !== undefined) set.evidenceUrl = changes.evidenceUrl;
  if (changes.note !== undefined) set.note = changes.note;
  if (changes.match) set.match = [...new Set(changes.match.map((m) => m.trim().toLowerCase()).filter(Boolean))];
  // Evidence without a status means it's at least done.
  if (changes.evidenceUrl && !changes.status) {
    Object.assign(set, {
      status: sql`CASE WHEN ${roadmapItems.status} IN ('todo', 'bezig') THEN 'klaar' ELSE ${roadmapItems.status} END`,
      statusSource: source,
      statusAt: new Date(),
    });
  }
  const [row] = await db.update(roadmapItems).set(set).where(eq(roadmapItems.id, id)).returning();
  return row;
}
