import { dayKey } from "@/lib/dates";
import { lastImport, listEvidence, type Evidence } from "./portflow";
import { getPlanning, planningSprints, type PlanningSprint } from "./planning";
import { COLLECTIONS, GOAL_NAMES, SUBGOALS, type EvidenceType, type GoalCode, type Target } from "./portfolio";

// Piet's Portflow next to the "good" one (portfolio.ts): every target row is
// either filled by his real evidence (white) or still to add (grey). Evidence
// that matches no target stays where he put it. All in code, no AI.

export type MirrorEvidence = {
  id: string;
  name: string;
  createdOn: string;
  type: string;
  feedback: boolean;
  subgoals: string[];
  /** Set when it sits somewhere else in Portflow than this row: what to change. */
  fix: string | null;
};
export type MirrorRow = {
  key: string;
  state: "have" | "todo" | "extra";
  title: string;
  type: EvidenceType | string;
  sub: string | null;
  what: string;
  content: string[];
  optional: boolean;
  evidence: MirrorEvidence[];
  /** Where the handbook asks for feedback: from whom, and the feedback found. */
  feedback: { who: string; found: MirrorEvidence[] } | null;
};
export type MirrorCollection = {
  slug: string;
  name: string;
  color: string;
  description: string;
  have: number;
  total: number;
  unlinked: MirrorRow[];
  sections: { goal: GoalCode; name: string; rows: MirrorRow[] }[];
};
export type Mirror = Awaited<ReturnType<typeof portflowMirror>>;

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9/]+/g, " ").trim();
// Feedback shows up as its own piece (red icon, "Coachingreview Petra") or as a
// teacher's assessment; it belongs to a row's feedback, not to the row itself.
const FEEDBACK_WORDS = ["feedback", "beoordeling", "coaching", "coachingreview"];
const isFeedback = (e: Evidence) => e.type === "feedback" || mentions(e.name, FEEDBACK_WORDS);

// Words match from the start of a word: "erd" is not in "leerdoelen".
const mentions = (name: string, words: string[]) => {
  const n = ` ${norm(name)}`;
  return words.some((w) => n.includes(` ${norm(w)}`));
};

/** "Retrospective sprint 1", "1e technische review", or else the sprint its date falls in. */
export function evidenceSprint(e: Pick<Evidence, "name" | "createdOn">, sprints: PlanningSprint[]) {
  const n = norm(e.name);
  const named = /sprint\s*(\d)/.exec(n) ?? /\b(\d)e\s+(?:technische|tech|sprint|coaching|retro)/.exec(n);
  if (named) return Number(named[1]);
  if (/onboarding|combireview|sprint\s*0/.test(n)) return 0;
  // Between two sprints (an "afwijkende" week) counts for the one that just ended.
  const before = sprints.filter((s) => s.start <= e.createdOn);
  return before.length ? before[before.length - 1].number : null;
}

type Row = { target: Target; collection: string; sprint: number | null; key: string; title: string };

function expand(target: Target, collection: string, sprints: PlanningSprint[], today: string): Row[] {
  if (target.perSprint === undefined) return [{ target, collection, sprint: null, key: target.id, title: target.title }];
  const due = sprints.filter((s) => s.number >= target.perSprint! && s.number <= 4 && s.start <= today);
  if (due.length === 0) return [{ target, collection, sprint: null, key: target.id, title: `${target.title} (elke sprint)` }];
  return due.map((s) => ({ target, collection, sprint: s.number, key: `${target.id}:${s.number}`, title: s.number === 0 ? `${target.title} onboarding` : `${target.title} sprint ${s.number}` }));
}

export async function portflowMirror(today = dayKey()) {
  const [evidence, planning, last] = await Promise.all([listEvidence(), getPlanning(), lastImport()]);
  const sprints = planningSprints(planning);
  const current = sprints.find((s) => today >= s.start && today <= s.end) ?? null;

  // Subgoal names as Portflow writes them, learned from Piet's own evidence.
  const subNames: Record<string, string> = { ...SUBGOALS };
  for (const e of evidence) for (const s of e.subgoals) {
    const m = /^([A-Z]{2}\d)\s*:\s*(.+)$/.exec(s.trim());
    if (m) subNames[m[1]] = m[2];
  }
  const subLabel = (code: string) => `${code}: ${subNames[code] ?? ""}`.replace(/: $/, "");

  const used = new Set<string>();
  const toMirror = (e: Evidence, collection: string, sub: string | null): MirrorEvidence => {
    const fixes: string[] = [];
    if (!e.collections.includes(collection)) fixes.push(e.collections.length ? `staat in ${e.collections.join(", ")}; zet in ${collection}` : `zet in ${collection}`);
    if (sub && !e.subgoals.some((s) => s.startsWith(sub))) fixes.push(`koppel aan ${subLabel(sub)}`);
    return { id: e.id, name: e.name, createdOn: e.createdOn, type: e.type, feedback: Boolean(e.feedbackStatus) || e.type === "feedback", subgoals: e.subgoals, fix: fixes.join(" · ") || null };
  };

  const collections: MirrorCollection[] = COLLECTIONS.map((c) => ({
    slug: c.slug,
    name: c.name,
    color: c.color,
    description: c.description,
    have: 0,
    total: 0,
    unlinked: [],
    sections: c.goals.map((goal) => ({ goal, name: GOAL_NAMES[goal], rows: [] as MirrorRow[] })),
  }));

  // Target rows first, in order: each piece of evidence fills at most one row.
  for (const [ci, c] of COLLECTIONS.entries()) {
    for (const row of c.targets.flatMap((t) => expand(t, c.name, sprints, today))) {
      const sameSprint = (e: Evidence) => row.sprint === null || evidenceSprint(e, sprints) === row.sprint;
      const hits = evidence.filter((e) => !used.has(e.id) && !(row.target.feedback && isFeedback(e)) && mentions(e.name, row.target.words) && sameSprint(e));
      const here = hits.filter((e) => e.collections.includes(c.name));
      // Per sprint the words and sprint together are specific enough to take everything.
      const taken = here.length ? here : row.sprint === null ? hits.slice(0, 1) : hits;
      taken.forEach((e) => used.add(e.id));
      let feedback: MirrorRow["feedback"] = null;
      if (row.target.feedback) {
        // A feedback piece that names this row (and its sprint, for per-sprint rows).
        const pieces = evidence.filter((e) => !used.has(e.id) && isFeedback(e) && sameSprint(e) && mentions(e.name, [...row.target.words, ...(row.target.feedbackWords ?? [])]));
        pieces.forEach((e) => used.add(e.id));
        const found = [...taken.filter((e) => e.feedbackStatus), ...pieces].map((e) => ({ ...toMirror(e, c.name, null), fix: null }));
        feedback = { who: row.target.feedback, found };
      }
      const section = collections[ci].sections.find((s) => s.goal === row.target.goal)!;
      section.rows.push({
        key: row.key,
        state: taken.length ? "have" : "todo",
        title: row.title,
        type: row.target.type,
        sub: subLabel(row.target.sub),
        what: row.target.what,
        content: row.target.content,
        optional: Boolean(row.target.optional),
        evidence: taken.map((e) => toMirror(e, c.name, row.target.sub)),
        feedback,
      });
      if (!row.target.optional) {
        collections[ci].total++;
        if (taken.length) collections[ci].have++;
      }
    }
  }

  // The rest stays where Piet put it, as Portflow shows it.
  const noCollection: MirrorEvidence[] = [];
  for (const e of evidence.filter((e) => !used.has(e.id))) {
    const homes = collections.filter((c) => e.collections.includes(c.name));
    if (homes.length === 0) noCollection.push(toMirror(e, "een collectie", null));
    for (const home of homes) {
      const extra: MirrorRow = { key: `extra:${e.id}:${home.name}`, state: "extra", title: e.name, type: e.type, sub: null, what: "", content: [], optional: false, evidence: [{ ...toMirror(e, home.name, null), fix: null }], feedback: null };
      const goal = e.goals.find((g) => g in GOAL_NAMES) as GoalCode | undefined;
      if (!goal) {
        home.unlinked.push(extra);
        continue;
      }
      let section = home.sections.find((s) => s.goal === goal);
      if (!section) home.sections.push((section = { goal, name: GOAL_NAMES[goal], rows: [] }));
      section.rows.push(extra);
    }
  }

  return {
    collections,
    noCollection,
    sprint: current?.name ?? null,
    evidenceCount: evidence.length,
    lastImport: last?.toISOString() ?? null,
  };
}
