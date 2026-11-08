import { listEvents } from "@/lib/calendar/feeds";
import { listTasks } from "@/lib/ticktick/client";
import { addDays, dayKey, zonedDate } from "@/lib/dates";
import { SCHOOL } from "@/lib/config";
import { formatDue } from "@/lib/telegram/quick";
import { ago } from "@/lib/gitlab/progress";
import { listRoadmap, TRACKED_KINDS, type RoadmapItem, type SchoolStatus } from "./roadmap";
import { gitlabSignals, matchWords, type Signal } from "./signals";

// "Waar moet ik aan werken?" in code, no AI: finish what's started, then what
// has a deadline coming, then the theme that's furthest behind.

export const STATUS_LABEL: Record<SchoolStatus, string> = {
  todo: "⬜ nog niet begonnen",
  bezig: "🔨 bezig",
  klaar: "✅ klaar, nog niet in Portflow",
  in_portflow: "📎 in Portflow",
};

// Calendar events only count as a deadline when they look like one; a weekly
// lesson that happens to share a word with an item doesn't.
export const DEADLINE_WORDS = /deadline|inlever|oplever|assessment|beoordel|review|presentatie|pitch|demo|dragon/i;

export type ThemeProgress = { theme: string; done: number; inPortflow: number; total: number };
export type Deadline = { day: string; title: string };
export type FocusItem = { item: RoadmapItem; score: number; reasons: string[] };

export type SchoolPicture = {
  all: RoadmapItem[];
  tracked: RoadmapItem[];
  themes: ThemeProgress[];
  focus: FocusItem[];
  /** Klaar, waiting to be put in Portflow. */
  portflow: RoadmapItem[];
  signals: Map<string, Signal>;
  deadlines: Map<string, Deadline>;
};

const isDone = (i: RoadmapItem) => i.status === "klaar" || i.status === "in_portflow";
const daysSince = (date: Date | null) => (date ? Math.floor((Date.now() - date.getTime()) / 86_400_000) : Infinity);

function themeProgress(tracked: RoadmapItem[]): ThemeProgress[] {
  const byTheme = new Map<string, RoadmapItem[]>();
  for (const item of tracked) {
    const theme = item.theme ?? "Overig";
    byTheme.set(theme, [...(byTheme.get(theme) ?? []), item]);
  }
  return [...byTheme].map(([theme, items]) => ({
    theme,
    done: items.filter(isDone).length,
    inPortflow: items.filter((i) => i.status === "in_portflow").length,
    total: items.length,
  }));
}

/** The first calendar event or TickTick task within SCHOOL.deadlineDays that names the item. */
async function upcomingDeadlines(items: RoadmapItem[]) {
  const today = dayKey();
  const until = addDays(today, SCHOOL.deadlineDays);
  const [events, tasks] = await Promise.all([
    listEvents(zonedDate(today), zonedDate(addDays(until, 1))),
    listTasks().catch(() => null),
  ]);
  const candidates: Deadline[] = [
    ...events.filter((e) => DEADLINE_WORDS.test(e.title)).map((e) => ({ day: dayKey(new Date(e.startsAt)), title: e.title })),
    ...(tasks ?? []).filter((t) => t.dueDay && t.dueDay >= today && t.dueDay <= until).map((t) => ({ day: t.dueDay!, title: t.title })),
  ].sort((a, b) => a.day.localeCompare(b.day));

  const found = new Map<string, Deadline>();
  for (const item of items) {
    const words = matchWords(item);
    const hit = candidates.find((c) => words.some((w) => c.title.toLowerCase().includes(w)));
    if (hit) found.set(item.id, hit);
  }
  return found;
}

export async function schoolPicture(): Promise<SchoolPicture> {
  const all = await listRoadmap();
  const tracked = all.filter((i) => TRACKED_KINDS.includes(i.kind));
  const open = tracked.filter((i) => !isDone(i));
  const [signals, deadlines] = await Promise.all([gitlabSignals(tracked), upcomingDeadlines(open)]);
  const themes = themeProgress(tracked);
  const share = (t: ThemeProgress) => (t.total ? t.done / t.total : 1);
  const average = themes.reduce((sum, t) => sum + share(t), 0) / (themes.length || 1);

  const today = dayKey();
  const focus = open
    .map((item): FocusItem => {
      const reasons: string[] = [];
      let score = item.status === "bezig" ? 3 : 1;
      if (item.status === "bezig") reasons.push("al begonnen, afmaken");
      const signal = signals.get(item.id);
      if (signal) {
        score += 1;
        reasons.push(`in GitLab mee bezig (${ago(signal.lastAt)})`);
      } else if (item.status === "bezig" && daysSince(item.statusAt) >= SCHOOL.staleDays) {
        score += 1;
        reasons.push(`ligt al ${daysSince(item.statusAt)} dagen stil`);
      }
      const deadline = deadlines.get(item.id);
      if (deadline) {
        const daysLeft = Math.max(Math.round((Date.parse(deadline.day) - Date.parse(today)) / 86_400_000), 0);
        score += 3 + (SCHOOL.deadlineDays - daysLeft) / 2;
        reasons.push(`${deadline.title} ${formatDue(deadline.day, null)}`);
      }
      const theme = themes.find((t) => t.theme === (item.theme ?? "Overig"));
      if (theme && share(theme) < average) {
        score += 2 * (1 - share(theme));
        reasons.push(`${theme.theme} loopt achter (${theme.done}/${theme.total})`);
      }
      // Products are what's assessed; side quests lead up to them.
      if (item.kind === "product") score += 0.5;
      return { item, score, reasons };
    })
    .sort((a, b) => b.score - a.score || a.item.position - b.item.position)
    .slice(0, SCHOOL.focusItems);

  return {
    all,
    tracked,
    themes,
    focus,
    portflow: tracked.filter((i) => i.status === "klaar"),
    signals,
    deadlines,
  };
}

export const themeLine = (t: ThemeProgress) => `${t.theme} ${t.done}/${t.total}${t.inPortflow ? ` (${t.inPortflow} in Portflow)` : ""}`;
const KIND_LABELS: Record<string, string> = { product: "product", side: "side-quest", assignment: "opdracht", knowledge: "kennisartikel", outcome: "leeruitkomst" };
const kindLabel = (i: RoadmapItem) => KIND_LABELS[i.kind] ?? i.kind;
// Enough for a whole assignment or knowledge article (most are 2–4k characters).
const ITEM_TEXT_CHARS = 6000;
export const focusLine = (f: FocusItem) => `${f.item.title} (${kindLabel(f.item)}): ${f.reasons.join(", ") || "nog niet begonnen"}`;

/** Facts for the coach's morning check-in and Sunday review. */
export function schoolFacts(p: SchoolPicture) {
  if (p.tracked.length === 0) return "";
  return [
    `School roadmap per theme (done/total): ${p.themes.map(themeLine).join("; ")}`,
    p.focus.length ? `School focus suggestion: ${p.focus.map(focusLine).join("; ")}` : "",
    p.portflow.length ? `Done but not yet in Portflow: ${p.portflow.map((i) => i.title).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The short version for the morning check-in: just today's focus and what's waiting for Portflow. */
export function schoolMorningFact(p: SchoolPicture) {
  return [
    p.focus[0] ? `School focus: ${focusLine(p.focus[0])}` : "",
    p.portflow.length ? `Done but not yet in Portflow: ${p.portflow.map((i) => i.title).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The /school message. */
export function schoolOverview(p: SchoolPicture) {
  if (p.tracked.length === 0) return "De roadmap is nog niet binnengehaald. Probeer het over een minuut opnieuw.";
  const lines = ["🎓 Roadmap", ...p.themes.map((t) => `- ${themeLine(t)}`)];
  if (p.focus.length) {
    lines.push("", "🎯 Hier zou ik nu aan werken", ...p.focus.map((f, i) => `${i + 1}. ${focusLine(f)}`));
  }
  if (p.portflow.length) lines.push("", "📎 Klaar, nog in Portflow zetten", ...p.portflow.map((i) => `- ${i.title}`));
  const busy = p.tracked.filter((i) => i.status === "bezig" && !p.focus.some((f) => f.item.id === i.id));
  if (busy.length) lines.push("", `🔨 Ook bezig: ${busy.map((i) => i.title).join(", ")}`);
  lines.push("", "Details en status aanpassen: /school <naam>, bv. /school retrospective");
  return lines.join("\n");
}

/** One item in full: what it is, what it links to, and where Piet is. */
export function itemDetail(item: RoadmapItem, p: SchoolPicture) {
  const byId = new Map(p.all.map((i) => [i.id, i]));
  const names = (ids: string[] | undefined) => (ids ?? []).map((id) => byId.get(id)).filter((i): i is RoadmapItem => Boolean(i));
  const lines = [`🎓 ${item.title} (${kindLabel(item)}${item.theme ? `, ${item.theme}` : ""})`, `Status: ${STATUS_LABEL[item.status as SchoolStatus] ?? item.status}`];
  if (item.description) lines.push("", item.description.length > 600 ? `${item.description.slice(0, 600)}…` : item.description);

  const products = names(item.links.products);
  if (products.length) lines.push("", `Levert op: ${products.map((i) => `${i.title} (${STATUS_LABEL[i.status as SchoolStatus] ?? i.status})`).join(", ")}`);
  if (item.kind === "product") {
    const madeIn = p.all.filter((a) => a.links.products?.includes(item.id));
    if (madeIn.length) lines.push("", `Gemaakt in: ${madeIn.map((a) => a.title).join(", ")}`);
  }
  const outcomes = names(item.links.outcomes);
  if (outcomes.length) lines.push(`Leeruitkomsten: ${outcomes.map((o) => `${o.code} ${o.title}`).join(", ")}`);
  const knowledge = names(item.links.knowledge);
  if (knowledge.length) lines.push(`Kennis: ${knowledge.slice(0, 5).map((k) => k.title).join(", ")}${knowledge.length > 5 ? ` en nog ${knowledge.length - 5}` : ""}`);

  const deadline = p.deadlines.get(item.id);
  if (deadline) lines.push("", `⏰ ${deadline.title} ${formatDue(deadline.day, null)}`);
  const signal = p.signals.get(item.id);
  if (signal) lines.push("", `GitLab (${signal.count}×, laatst ${ago(signal.lastAt)}): ${signal.examples.join("; ")}`);
  if (item.evidenceUrl) lines.push("", `Bewijs: ${item.evidenceUrl}`);
  if (item.note) lines.push(`Notitie: ${item.note}`);
  return lines.join("\n");
}

/** Same as itemDetail but for the assistant: structured, with the outcome criteria. */
export function itemForAssistant(item: RoadmapItem, p: SchoolPicture) {
  const byId = new Map(p.all.map((i) => [i.id, i]));
  return {
    title: item.title,
    kind: kindLabel(item),
    theme: item.theme,
    status: item.status,
    description: item.description.slice(0, ITEM_TEXT_CHARS),
    products: (item.links.products ?? []).map((id) => byId.get(id)).filter(Boolean).map((i) => `${i!.title}: ${i!.status}`),
    made_in: item.kind === "product" ? p.all.filter((a) => a.links.products?.includes(item.id)).map((a) => a.title) : undefined,
    outcomes: (item.links.outcomes ?? []).map((id) => byId.get(id)).filter(Boolean).map((o) => ({ outcome: `${o!.code} ${o!.title}`, criteria: o!.description })),
    knowledge: (item.links.knowledge ?? []).map((id) => byId.get(id)?.title).filter(Boolean),
    deadline: p.deadlines.get(item.id),
    gitlab: p.signals.get(item.id),
    evidence_url: item.evidenceUrl,
    note: item.note,
    match_words: matchWords(item),
  };
}
