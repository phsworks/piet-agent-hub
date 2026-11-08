import { and, asc, eq, ilike, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { roadmapItems, type RoadmapLinks } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import { SCHOOL } from "@/lib/config";

// The roadmap site is a static app that loads one roadmap.json; everything we
// need (titles, themes, links between items) is in there, except the knowledge
// articles' text, which sits next to it as one .md per article. No AI involved.

const EXPORTED_KEY = "school_roadmap_exported_at";
// Bumped when the sync reads more of the export, so the next run refetches even if the export didn't change.
const SYNC_VERSION = "2";
// The knowledge articles are small static files; a few at a time is gentle on the site.
const ARTICLE_BATCH = 8;

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
  knowledge: { id: string; title: string; desc: string; location?: string | null }[];
  canvas: { positions: Record<string, { container_id: string | null }>; containers: { id: string; title: string }[] };
};

/** Fetches roadmap.json and upserts it; skipped when the export didn't change (unless forced). */
export async function syncRoadmap(force = false) {
  const res = await fetch(new URL("roadmap.json", SCHOOL.roadmapUrl), { cache: "no-store" });
  if (!res.ok) throw new Error(`roadmap.json: HTTP ${res.status}`);
  const data = (await res.json()) as RoadmapJson;
  const version = `${data.exported_at}|${SYNC_VERSION}`;
  if (!force && (await getSetting<string>(EXPORTED_KEY)) === version) return { changed: false, items: 0 };
  const articles = await fetchArticles(data.knowledge);

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
    ...data.knowledge.map((k) => ({ id: k.id, kind: "knowledge", title: k.title, code: null, theme: null, description: articles.get(k.id) || k.desc || "", links: {} })),
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
  await setSetting(EXPORTED_KEY, version);
  console.log(`[school] roadmap synced: ${rows.length} items, ${articles.size}/${data.knowledge.length} knowledge articles (export ${data.exported_at})`);
  return { changed: true, items: rows.length };
}

/** The knowledge articles' Markdown (without front matter), by item id. A missing article just stays empty. */
async function fetchArticles(knowledge: RoadmapJson["knowledge"]) {
  const texts = new Map<string, string>();
  const withFile = knowledge.filter((k) => k.location);
  for (let i = 0; i < withFile.length; i += ARTICLE_BATCH) {
    await Promise.all(
      withFile.slice(i, i + ARTICLE_BATCH).map(async (k) => {
        const res = await fetch(new URL(k.location!, SCHOOL.roadmapUrl), { cache: "no-store" }).catch(() => null);
        if (!res?.ok) return;
        const text = (await res.text()).replace(/^---\n[\s\S]*?\n---\n/, "").replace(/\]\(ARTICLE_LINK\)/g, "]").trim();
        if (text) texts.set(k.id, text);
      })
    );
  }
  return texts;
}

export async function listRoadmap() {
  return db.select().from(roadmapItems).orderBy(asc(roadmapItems.position));
}

export async function listTracked() {
  return db.select().from(roadmapItems).where(inArray(roadmapItems.kind, TRACKED_KINDS)).orderBy(asc(roadmapItems.position));
}

/**
 * A side quest or product (or, with anyKind, any roadmap item: assignments,
 * knowledge articles, outcomes) by (part of) its title. An exact title wins;
 * with several partial matches the caller gets them all to ask which one.
 */
export async function findSchoolItem(query: string, anyKind = false): Promise<{ item: RoadmapItem | null; candidates: RoadmapItem[] }> {
  const q = query.trim();
  if (!q) return { item: null, candidates: [] };
  const title = ilike(roadmapItems.title, `%${q}%`);
  const rows = await db
    .select()
    .from(roadmapItems)
    .where(anyKind ? title : and(inArray(roadmapItems.kind, TRACKED_KINDS), title))
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
