import { addDays, dayKey } from "@/lib/dates";
import { getSetting, setSetting } from "@/lib/settings";
import { SCHOOL } from "@/lib/config";

// The HvA "Onderwijsplanning" (sprintplanning.ict-hva.nl) is a Next.js site
// with the whole planning in its page payload; there is no API. We cut Piet's
// module out of that payload, keep it in settings and refresh it twice a day.
// No AI involved.

const CACHE_KEY = "school_planning";
const MAX_AGE_MS = 12 * 3_600_000;

export type PlanningItem = { text: string; links: string[] };
export type PlanningWeek = {
  date: string;
  /** "ONBOARDEN", "SPRINT 1", "AFWIJKEND", or "". */
  rail: string;
  project: string;
  theme: string;
  slots: { label: string; items: PlanningItem[] }[];
  /** High-stakes decision week (end of the semester). */
  decision: boolean;
};
export type Planning = { fetchedAt: string; label: string; weeks: PlanningWeek[] };
export type PlanningSprint = { number: number; name: string; start: string; end: string };

type Block = { text?: string; hrefs?: { url: string; teacherOnly?: boolean }[] };
type RawModule = {
  label: string;
  weeks: { date: string; rail: string; key: string; decision: boolean }[];
  weekContent: Record<string, Record<string, unknown>>;
  daySlots: Record<string, { label: string; enabled?: boolean }>;
};

/** The JSON object that starts at `start`, by counting braces outside strings. */
export function sliceObject(text: string, start: number) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error("planning: object not closed");
}

/** Every block's text and student links under a slot, in order. */
function blocks(node: unknown, out: PlanningItem[] = []): PlanningItem[] {
  if (Array.isArray(node)) node.forEach((n) => blocks(n, out));
  else if (node && typeof node === "object") {
    const b = node as Block;
    const text = typeof b.text === "string" ? b.text.replace(/\s+/g, " ").trim() : "";
    if (text && text !== "nnb" && text !== "$undefined") {
      out.push({ text, links: (b.hrefs ?? []).filter((h) => !h.teacherOnly).map((h) => h.url) });
    }
    for (const [k, v] of Object.entries(node)) if (k !== "hrefs") blocks(v, out);
  }
  return out;
}

export function parsePlanning(html: string, moduleId: string): Omit<Planning, "fetchedAt"> {
  const pushes = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)];
  const payload = pushes.map((m) => JSON.parse(`"${m[1]}"`) as string).join("");
  const start = payload.indexOf(`{"id":"${moduleId}"`);
  if (start < 0) throw new Error(`planning: module ${moduleId} not found`);
  const raw = JSON.parse(sliceObject(payload, start)) as RawModule;
  const str = (v: unknown) => (typeof v === "string" && v !== "$undefined" ? v.trim() : "");
  return {
    label: raw.label,
    weeks: raw.weeks.map((w) => {
      const content = (w.key && raw.weekContent[w.key]) || {};
      const slots = Object.entries(raw.daySlots)
        .filter(([, s]) => s.enabled !== false)
        .map(([key, s]) => ({ label: s.label, items: blocks(content[key]) }))
        .filter((s) => s.items.length > 0);
      // The two coaching days share a label; show them as one list.
      const merged: PlanningWeek["slots"] = [];
      for (const s of slots) {
        const known = merged.find((m) => m.label === s.label);
        if (known) known.items.push(...s.items.filter((i) => !known.items.some((k) => k.text === i.text)));
        else merged.push({ label: s.label, items: s.items.filter((i, n, all) => all.findIndex((k) => k.text === i.text) === n) });
      }
      return { date: w.date, rail: w.rail.trim(), project: str(content.project), theme: str(content.theme), slots: merged, decision: w.decision };
    }),
  };
}

/** The cached planning, refreshed when older than 12 hours; the cache stays when the site is down. */
export async function getPlanning(): Promise<Planning | null> {
  const cached = await getSetting<Planning>(CACHE_KEY);
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < MAX_AGE_MS) return cached;
  try {
    const res = await fetch(SCHOOL.planningUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const planning = { fetchedAt: new Date().toISOString(), ...parsePlanning(await res.text(), SCHOOL.planningModule) };
    await setSetting(CACHE_KEY, planning);
    return planning;
  } catch (err) {
    console.error("[school] planning fetch failed", err);
    return cached ?? null;
  }
}

/** Sprints as the planning names them: ONBOARDEN = 0, "SPRINT n" = n. */
export function planningSprints(planning: Planning | null): PlanningSprint[] {
  const sprints = new Map<number, PlanningSprint>();
  for (const w of planning?.weeks ?? []) {
    const n = w.rail === "ONBOARDEN" ? 0 : Number(/^SPRINT\s*(\d+)$/.exec(w.rail)?.[1] ?? NaN);
    if (Number.isNaN(n)) continue;
    const s = sprints.get(n);
    if (s) s.end = addDays(w.date, 6);
    else sprints.set(n, { number: n, name: n === 0 ? "Onboarding" : `Sprint ${n}`, start: w.date, end: addDays(w.date, 6) });
  }
  return [...sprints.values()].sort((a, b) => a.number - b.number);
}

export const sprintOnDay = (sprints: PlanningSprint[], day = dayKey()) => sprints.find((s) => day >= s.start && day <= s.end) ?? null;

// Self-check on a tiny payload: braces inside strings, slots merged, teacher links dropped.
{
  const mod = {
    id: "m",
    label: "L",
    weeks: [{ date: "2026-09-21", rail: "SPRINT 1", key: "k", decision: false }],
    weekContent: { k: { project: "P {x}", theme: "$undefined", coach: [{ text: "Coaching", hrefs: [{ url: "t", teacherOnly: true }] }], coach2: [{ text: "Coaching" }, { text: "Retro", hrefs: [{ url: "u" }] }] } },
    daySlots: { coach: { label: "Coaching" }, coach2: { label: "Coaching" } },
  };
  const html = `<script>self.__next_f.push([1,${JSON.stringify(`x:${JSON.stringify(mod)}`)}])</script>`;
  const p = parsePlanning(html, "m");
  const w = p.weeks[0];
  if (w.project !== "P {x}" || w.theme !== "" || w.slots.length !== 1 || w.slots[0].items.map((i) => i.text).join() !== "Coaching,Retro" || w.slots[0].items[0].links.length !== 0) {
    throw new Error(`planning self-check failed: ${JSON.stringify(p)}`);
  }
}
