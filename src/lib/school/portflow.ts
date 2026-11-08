import Anthropic from "@anthropic-ai/sdk";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { portflowEvidence, roadmapItems } from "@/lib/db/schema";
import { ASSISTANT_MODEL, CONTENT_LANGUAGE, FAST_MODEL_NAME, PORTFLOW } from "@/lib/config";
import { dayKey } from "@/lib/dates";
import { getSetting, setSetting } from "@/lib/settings";
import { formatDue } from "@/lib/telegram/quick";
import { listTracked, updateSchoolItem } from "./roadmap";
import { currentSprints, sprintInName, sprintOn, type Sprint } from "./sprints";

// Portflow has no student API, so Piet sends screenshots of "Mijn bewijs".
// Reading them is the only AI step (one Haiku call per screenshot); what's
// missing per sprint is worked out in code.

const anthropic = new Anthropic();

export type Evidence = typeof portflowEvidence.$inferSelect;
type GoalCode = keyof typeof PORTFLOW.goals;
const GOAL_CODES = Object.keys(PORTFLOW.goals) as GoalCode[];

const LAST_IMPORT_KEY = "portflow_last_import";
// A finished sprint with fewer pieces than this for a goal gets a warning.
const THIN_GOAL = 2;

type ReadRow = {
  type: string;
  name: string;
  created_on: string;
  collections: string[];
  goals: string[];
  subgoals: string[];
  feedback_status: string | null;
};

const READ_TOOL: Anthropic.Tool = {
  name: "record_evidence",
  description: "Record every row of the Portflow evidence table visible in the screenshot.",
  input_schema: {
    type: "object",
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["file", "link", "feedback", "other"], description: "The icon in the Type column: green page = file, yellow chain = link, red/pink = feedback." },
            name: { type: "string", description: "The Naam column, exactly as shown (both lines joined with a space)." },
            created_on: { type: "string", description: "Aanmaakdatum as YYYY-MM-DD (Dutch month names, e.g. '27 oktober 2026' → 2026-10-27)." },
            collections: { type: "array", items: { type: "string" }, description: "Gelinkte collecties, e.g. 'de Techneut'. Empty when it says 'Geen collecties'." },
            goals: { type: "array", items: { type: "string" }, description: "Gekoppelde doelen as shown, e.g. 'Ontwerpen & Realiseren'." },
            subgoals: { type: "array", items: { type: "string" }, description: "Gekoppelde subdoelen as shown, e.g. 'MS4: Teamcoördinatie'." },
            feedback_status: { type: ["string", "null"], description: "Laatste feedbackstatus, null when empty." },
          },
          required: ["type", "name", "created_on", "collections", "goals", "subgoals", "feedback_status"],
        },
      },
    },
    required: ["rows"],
  },
};

/** One screenshot → the table rows on it. Rows cut off at the top or bottom are skipped by the model. */
export async function readScreenshot(buffer: Buffer, mediaType: "image/png" | "image/jpeg" | "image/webp"): Promise<ReadRow[]> {
  const response = await anthropic.messages.create({
    model: FAST_MODEL_NAME,
    max_tokens: 8000,
    tools: [READ_TOOL],
    tool_choice: { type: "tool", name: READ_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } },
          {
            type: "text",
            text: "This is a screenshot of the 'Mijn bewijs' page in Portflow (a student portfolio). Record every complete table row. Skip rows that are cut off. Copy names exactly; don't guess text you can't read. If this is not that page, record no rows.",
          },
        ],
      },
    ],
  });
  console.log(`[tokens] portflow in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);
  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const rows = (call?.input as { rows?: ReadRow[] } | undefined)?.rows ?? [];
  return rows.filter((r) => r.name?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(r.created_on));
}

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/** "Ontwerpen & Realise…" → OR; labels from other semesters stay as they are. */
function goalCode(label: string): string {
  const w = words(label);
  if (w.startsWith("ontwerp")) return "OR";
  if (w.startsWith("pers")) return "PL";
  if (w.startsWith("analys")) return "AA";
  if (w.startsWith("manag")) return "MS";
  return label.trim();
}

/** "de Techneut" → "De Techneut", like the roadmap themes. */
const collection = (c: string) => c.trim().replace(/^de\s/i, "De ");

/** The side quest or product an evidence name starts with ("Projectplan Kova" → Projectplan). */
function roadmapMatch(name: string, tracked: Awaited<ReturnType<typeof listTracked>>) {
  const n = words(name);
  const hits = tracked.filter((t) => {
    const title = words(t.title);
    return n === title || n.startsWith(`${title} `) || t.match.some((m) => n.includes(words(m)));
  });
  // The longest title wins ("User stories: Requirements" over "User stories").
  return hits.sort((a, b) => b.title.length - a.title.length)[0] ?? null;
}

/**
 * Upserts the rows of one screenshot. New evidence that names a roadmap item
 * moves that item to in_portflow, so Piet doesn't have to tick it off himself.
 */
export async function importEvidence(rows: ReadRow[]) {
  const tracked = await listTracked();
  let added = 0;
  const marked: string[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const item = roadmapMatch(r.name, tracked);
    const name = r.name.trim();
    const copy = seen.get(`${name}|${r.created_on}`) ?? 0;
    seen.set(`${name}|${r.created_on}`, copy + 1);
    const values = {
      name,
      type: r.type || "file",
      createdOn: r.created_on,
      copy,
      collections: r.collections.map(collection).filter(Boolean),
      goals: [...new Set(r.goals.map(goalCode).filter(Boolean))],
      subgoals: r.subgoals.map((s) => s.trim()).filter(Boolean),
      feedbackStatus: r.feedback_status?.trim() || null,
      roadmapItemId: item?.id ?? null,
    };
    const [row] = await db
      .insert(portflowEvidence)
      .values(values)
      .onConflictDoUpdate({
        target: [portflowEvidence.name, portflowEvidence.createdOn, portflowEvidence.copy],
        set: { ...values, roadmapItemId: sql`coalesce(excluded.roadmap_item_id, ${portflowEvidence.roadmapItemId})`, lastSeenAt: new Date() },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (row?.inserted) added++;
    if (item && item.status !== "in_portflow") {
      await updateSchoolItem(item.id, { status: "in_portflow" });
      item.status = "in_portflow";
      marked.push(item.title);
    }
  }
  await setSetting(LAST_IMPORT_KEY, new Date().toISOString());
  return { read: rows.length, added, marked };
}

export async function lastImport() {
  const at = await getSetting<string>(LAST_IMPORT_KEY);
  return at ? new Date(at) : null;
}

export async function listEvidence() {
  return db.select().from(portflowEvidence).orderBy(desc(portflowEvidence.createdOn), asc(portflowEvidence.name));
}

export async function removeEvidence(id: string) {
  await db.delete(portflowEvidence).where(eq(portflowEvidence.id, id));
}

// ---------- The check (no AI) ----------

export type SprintCheck = {
  sprint: Sprint;
  running: boolean;
  evidence: Evidence[];
  /** Per-sprint items (retrospective, ...) and how often they're there. */
  checklist: { label: string; count: number }[];
  goals: Record<GoalCode, number>;
  missingThemes: string[];
};

export type PortflowReport = {
  total: number;
  last: Date | null;
  checks: SprintCheck[];
  noCollection: Evidence[];
  noGoal: Evidence[];
  duplicates: { name: string; count: number }[];
  withoutFeedback: number;
  waiting: string[];
};

const has = (e: Evidence, phrases: readonly string[]) => phrases.some((p) => words(e.name).includes(words(p)));
// Feedback shows up three ways: a feedback status, a feedback piece of its own
// (red icon, e.g. a coaching review), or a teacher's assessment uploaded as a file.
const FEEDBACK_WORDS = ["feedback", "beoordeling", "coaching", "technische review", "tech review"];
const hasFeedback = (e: Evidence) => Boolean(e.feedbackStatus) || e.type === "feedback" || has(e, FEEDBACK_WORDS);

function sprintOf(e: Evidence, sprints: Sprint[]) {
  const named = sprintInName(e.name);
  return named !== null ? (sprints.find((s) => s.number === named) ?? null) : sprintOn(sprints, e.createdOn);
}

export async function portflowReport(today = dayKey()): Promise<PortflowReport> {
  const [{ sprints, current, previous }, all, last, tracked, themes] = await Promise.all([
    currentSprints(today),
    listEvidence(),
    lastImport(),
    listTracked(),
    db.selectDistinct({ theme: roadmapItems.theme }).from(roadmapItems),
  ]);
  // Only this semester: from the onboarding on.
  const semester = sprints[0] ? all.filter((e) => e.createdOn >= sprints[0].start) : all;
  const themeNames = themes.map((t) => t.theme).filter((t): t is string => Boolean(t));

  const checks = [previous, current]
    .filter((s): s is Sprint => Boolean(s))
    .map((sprint): SprintCheck => {
      const evidence = semester.filter((e) => sprintOf(e, sprints)?.number === sprint.number);
      const goals = Object.fromEntries(GOAL_CODES.map((g) => [g, evidence.filter((e) => e.goals.includes(g)).length])) as Record<GoalCode, number>;
      return {
        sprint,
        running: today <= sprint.end,
        evidence,
        // Onboarding has no sprint events.
        checklist: sprint.number === 0 ? [] : PORTFLOW.perSprint.map((c) => ({ label: c.label, count: evidence.filter((e) => has(e, c.words)).length })),
        goals,
        missingThemes: themeNames.filter((t) => !evidence.some((e) => e.collections.includes(t))),
      };
    });

  const counts = new Map<string, { name: string; count: number }>();
  for (const e of semester) {
    const key = words(e.name.replace(/\.\w{2,5}$/, ""));
    const entry = counts.get(key) ?? { name: e.name, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }

  return {
    total: semester.length,
    last,
    checks,
    noCollection: semester.filter((e) => e.collections.length === 0),
    noGoal: semester.filter((e) => e.goals.length === 0),
    duplicates: [...counts.values()].filter((d) => d.count > 1),
    withoutFeedback: semester.filter((e) => !hasFeedback(e)).length,
    waiting: tracked.filter((t) => t.status === "klaar").map((t) => t.title),
  };
}

const short = (day: string) => formatDue(day, null).replace(/^\S+\s/, "");

function checkLines(c: SprintCheck) {
  const { sprint } = c;
  const lines = [`${c.running ? "▶️" : "🏁"} ${sprint.name} (${short(sprint.start)} – ${short(sprint.end)}): ${c.evidence.length} stuk${c.evidence.length === 1 ? "" : "ken"}`];
  const present = c.checklist.filter((i) => i.count > 0);
  const absent = c.checklist.filter((i) => i.count === 0);
  if (present.length) lines.push(`✓ ${present.map((i) => (i.count > 1 ? `${i.label} (${i.count}×)` : i.label)).join(", ")}`);
  if (absent.length) lines.push(`${c.running ? "⏳ Nog te doen" : "✗ Mist"}: ${absent.map((i) => i.label).join(", ")}`);
  lines.push(`Doelen: ${GOAL_CODES.map((g) => `${g} ${c.goals[g]}${!c.running && c.goals[g] < THIN_GOAL ? " ⚠️" : ""}`).join(" · ")}`);
  if (c.missingThemes.length && c.evidence.length) lines.push(`Geen bewijs voor: ${c.missingThemes.join(", ")}`);
  return lines;
}

/** The /portflow message. */
export function reportText(r: PortflowReport) {
  if (r.total === 0) {
    return "📎 Nog geen Portflow-bewijs binnen. Stuur /portflow en daarna screenshots van Mijn bewijs.";
  }
  const lines = [`📎 Portflow: ${r.total} stukken dit semester${r.last ? `, laatste screenshot ${formatDue(dayKey(r.last), null)}` : ""}`];
  if (r.checks.length === 0) lines.push("", "Geen sprints gevonden (GitLab-milestones \"Sprint 1\", …). Is het Kova-project gekoppeld?");
  for (const c of r.checks) lines.push("", ...checkLines(c));

  const tidy: string[] = [];
  if (r.noCollection.length) tidy.push(`Zonder collectie: ${r.noCollection.map((e) => e.name).join(", ")}`);
  if (r.noGoal.length) tidy.push(`Zonder doel: ${r.noGoal.map((e) => e.name).join(", ")}`);
  if (r.duplicates.length) tidy.push(`Dubbel: ${r.duplicates.map((d) => `${d.name} (${d.count}×)`).join(", ")}`);
  if (r.withoutFeedback === r.total) tidy.push("Op geen enkel stuk is feedback gevraagd. Vraag het bij je coach of docent; daarmee laat je groei zien.");
  else if (r.withoutFeedback > r.total / 2) tidy.push(`${r.withoutFeedback} van ${r.total} stukken hebben nog geen feedback.`);
  if (tidy.length) lines.push("", "🧹 Opruimen", ...tidy.map((t) => `- ${t}`));
  if (r.waiting.length) lines.push("", `📎 Klaar volgens je roadmap, nog niet gezien in Portflow: ${r.waiting.join(", ")}`);
  return lines.join("\n");
}

/** One line for the coach's check-ins. */
export function portflowFact(r: PortflowReport) {
  if (r.total === 0) return "";
  const parts = r.checks.map((c) => {
    const absent = c.checklist.filter((i) => i.count === 0).map((i) => i.label);
    const thin = c.running ? [] : GOAL_CODES.filter((g) => c.goals[g] < THIN_GOAL).map((g) => PORTFLOW.goals[g]);
    return `${c.sprint.name}${c.running ? " (running)" : " (finished)"}: ${absent.length ? `${c.running ? "still to do" : "missing"} ${absent.join(", ")}` : "all sprint events in"}${thin.length ? `; little evidence for ${thin.join(", ")}` : ""}`;
  });
  return `Portflow evidence: ${parts.join(" | ")}`;
}

/** 💡 Tips: one Haiku call on top of the check, with the learning outcomes' criteria. */
export async function portflowTips(r: PortflowReport) {
  const outcomes = await db.select({ code: roadmapItems.code, title: roadmapItems.title, description: roadmapItems.description }).from(roadmapItems).where(eq(roadmapItems.kind, "outcome"));
  const evidence = r.checks
    .map((c) => `${c.sprint.name}:\n${c.evidence.map((e) => `- ${e.name} [${e.collections.join(", ") || "geen collectie"}] doelen: ${e.goals.join(", ") || "geen"}${e.feedbackStatus ? ` feedback: ${e.feedbackStatus}` : ""}`).join("\n") || "- (niets)"}`)
    .join("\n\n");
  const response = await anthropic.messages.create({
    model: ASSISTANT_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low" },
    system: `You are Piet's study coach. Piet is an HBO-ICT propedeuse student at the HvA; his portfolio is in Portflow, where each piece of evidence is linked to collections (themes) and goals (learning outcomes). Write in ${CONTENT_LANGUAGE}, plain text, no markdown headings, at most 6 short numbered tips. Be concrete: name the evidence or the gap, say what to add or change and to which goal it should be linked. Use only the facts given.`,
    messages: [
      {
        role: "user",
        content: `Check (computed):\n${reportText(r)}\n\nEvidence per sprint:\n${evidence}\n\nLearning outcomes and their criteria:\n${outcomes.map((o) => `${o.code} ${o.title}:\n${o.description}`).join("\n\n")}\n\nHow can Piet improve his portfolio for these sprints?`,
      },
    ],
  });
  console.log(`[tokens] portflow tips in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
