import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { gitlabItems, gitlabProjects } from "@/lib/db/schema";
import { listEvents } from "@/lib/calendar/feeds";
import { listTasks } from "@/lib/ticktick/client";
import { addDays, dayKey, zonedDate } from "@/lib/dates";
import { PORTFLOW, SCHOOL } from "@/lib/config";
import { formatDue } from "@/lib/telegram/quick";
import { ago } from "@/lib/gitlab/progress";
import { listRoadmap, TRACKED_KINDS, type RoadmapItem, type SchoolStatus } from "./roadmap";
import { gitlabSignals, matchWords, type Signal } from "./signals";
import { listEvidence } from "./portflow";
import { currentSprints } from "./sprints";

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

/** Roadmap items ticked off, plus the pieces of Portflow evidence linked to the theme (a collection). */
export type ThemeProgress = { theme: string; done: number; inPortflow: number; total: number; evidence: number };
/** An open issue in the running sprint that isn't Piet's: somewhere he can help. */
export type TeamIssue = { title: string; project: string; url: string | null };
// Enough to offer a choice without turning it into a backlog.
const MAX_HELP_ISSUES = 5;
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
  /** Portflow evidence this semester per learning goal (OR, PL, AA, MS). */
  goals: Record<string, number>;
  /** The running sprint (from GitLab) and its open issues that aren't Piet's. */
  sprint: string | null;
  help: TeamIssue[];
};

const isDone = (i: RoadmapItem) => i.status === "klaar" || i.status === "in_portflow";
const daysSince = (date: Date | null) => (date ? Math.floor((Date.now() - date.getTime()) / 86_400_000) : Infinity);

function themeProgress(tracked: RoadmapItem[], evidenceByTheme: Map<string, number>): ThemeProgress[] {
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
    evidence: evidenceByTheme.get(theme) ?? 0,
  }));
}

/** Portflow evidence since the onboarding, counted per collection (theme) and goal; and the open sprint issues. */
async function progressFacts() {
  const [{ sprints, current }, evidence] = await Promise.all([currentSprints().catch(() => ({ sprints: [], current: null })), listEvidence()]);
  const semester = sprints[0] ? evidence.filter((e) => e.createdOn >= sprints[0].start) : evidence;
  const byTheme = new Map<string, number>();
  for (const e of semester) for (const c of e.collections) byTheme.set(c, (byTheme.get(c) ?? 0) + 1);
  const goals = Object.fromEntries(Object.keys(PORTFLOW.goals).map((g) => [g, semester.filter((e) => e.goals.includes(g)).length]));

  const sprint = current && current.number > 0 ? current.name : null;
  const help = sprint
    ? await db
        .select({ title: gitlabItems.title, project: gitlabProjects.name, url: gitlabItems.url })
        .from(gitlabItems)
        .innerJoin(gitlabProjects, eq(gitlabItems.projectId, gitlabProjects.id))
        .where(and(eq(gitlabItems.type, "issue"), eq(gitlabItems.state, "opened"), eq(gitlabItems.mine, false), eq(gitlabItems.milestone, sprint), ne(gitlabProjects.kind, "project")))
        .limit(MAX_HELP_ISSUES)
    : [];
  return { byTheme, goals, sprint, help };
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
  const [signals, deadlines, facts] = await Promise.all([gitlabSignals(tracked), upcomingDeadlines(open), progressFacts()]);
  const themes = themeProgress(tracked, facts.byTheme);
  const share = (t: ThemeProgress) => (t.total ? t.done / t.total : 1);
  const average = themes.reduce((sum, t) => sum + share(t), 0) / (themes.length || 1);
  // Roadmap ticks lag behind (Piet rarely sets them); a theme with its share of Portflow evidence isn't behind.
  const averageEvidence = themes.reduce((sum, t) => sum + t.evidence, 0) / (themes.length || 1);
  const behind = (t: ThemeProgress) => share(t) < average && t.evidence < averageEvidence;

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
      if (theme && behind(theme)) {
        score += 2 * (1 - share(theme));
        reasons.push(`weinig bewijs voor ${theme.theme} (${theme.evidence} in Portflow)`);
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
    goals: facts.goals,
    sprint: facts.sprint,
    help: facts.help,
  };
}

export const themeLine = (t: ThemeProgress) => `${t.theme}: ${t.evidence} stuk${t.evidence === 1 ? "" : "ken"} bewijs in Portflow, ${t.done}/${t.total} roadmap-items afgevinkt`;
export const goalsLine = (p: SchoolPicture) => Object.entries(p.goals).map(([g, n]) => `${g} ${n}`).join(" · ");
const helpLine = (i: TeamIssue) => `${i.title} (${i.project})`;
const KIND_LABELS: Record<string, string> = { product: "product", side: "side-quest", assignment: "opdracht", knowledge: "kennisartikel", outcome: "leeruitkomst" };
const kindLabel = (i: RoadmapItem) => KIND_LABELS[i.kind] ?? i.kind;
// Enough for a whole assignment or knowledge article (most are 2–4k characters).
const ITEM_TEXT_CHARS = 6000;
export const focusLine = (f: FocusItem) => `${f.item.title} (${kindLabel(f.item)}): ${f.reasons.join(", ") || "nog niet begonnen"}`;

/** Facts for the coach's morning check-in and Sunday review. */
export function schoolFacts(p: SchoolPicture) {
  if (p.tracked.length === 0) return "";
  return [
    `School per theme: ${p.themes.map(themeLine).join("; ")}`,
    `Portflow evidence per learning goal this semester: ${goalsLine(p)}`,
    p.help.length ? `Open issues in ${p.sprint} he could help with: ${p.help.map(helpLine).join("; ")}` : "",
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
  const lines = ["🎓 Zo sta je ervoor", ...p.themes.map((t) => `- ${themeLine(t)}`), `- Bewijs per leerdoel: ${goalsLine(p)}`];
  if (p.focus.length) {
    lines.push("", "🎯 Hier zou ik nu aan werken", ...p.focus.map((f, i) => `${i + 1}. ${focusLine(f)}`));
  }
  if (p.portflow.length) lines.push("", "📎 Klaar, nog in Portflow zetten", ...p.portflow.map((i) => `- ${i.title}`));
  if (p.help.length) lines.push("", `🤝 Hier kun je meehelpen (${p.sprint})`, ...p.help.map((i) => `- ${helpLine(i)}`));
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
