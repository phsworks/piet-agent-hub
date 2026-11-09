import { listEvents } from "@/lib/calendar/feeds";
import { addDays, dayKey, isoWeekday, timeKey, zonedDate } from "@/lib/dates";
import { COACH, DAY_PARTS, TIMEZONE } from "@/lib/config";
import type { DayPart } from "./goals";
import { getCoachPrefs } from "./prefs";

/** Days Piet keeps free of planning (coach pref noPlanDays). */
export async function isNoPlanDay(day: string) {
  return (await getCoachPrefs()).noPlanDays.includes(isoWeekday(day));
}

export type Slot = { start: string; end: string };

// Slots start on the hour or half hour; nobody plans a run at 07:13.
const STEP_MS = 30 * 60_000;

/**
 * Free time in Piet's calendar, found in code (no AI): per day, the window of
 * the preferred day part minus his events (with a margin around them). At most
 * one slot per day, the earliest that fits, so suggestions spread over the week.
 * All-day events (reminders, holidays) don't block time. Days in the coach
 * pref noPlanDays (Wednesday: Compagnon) are skipped.
 */
export async function findSlots(opts: {
  fromDay: string;
  days: number;
  durationMinutes: number;
  preferred: DayPart;
  /** Days to skip, e.g. ones that already have a session. */
  excludeDays?: string[];
  /** Slots to skip (alternatives for a suggestion). */
  excludeStarts?: string[];
  limit?: number;
}): Promise<Slot[]> {
  const lastDay = addDays(opts.fromDay, opts.days - 1);
  const { noPlanDays } = await getCoachPrefs();
  const events = await listEvents(zonedDate(opts.fromDay), zonedDate(addDays(lastDay, 1)));
  const margin = COACH.bufferMinutes * 60_000;
  const busy = events
    .filter((e) => !e.allDay)
    .map((e) => ({ start: Date.parse(e.startsAt) - margin, end: Date.parse(e.endsAt) + margin }));
  const duration = opts.durationMinutes * 60_000;
  const window = DAY_PARTS[opts.preferred];
  // Not in the next half hour: there has to be time to get ready.
  const earliest = Date.now() + STEP_MS;

  const slots: Slot[] = [];
  for (let i = 0; i < opts.days && slots.length < (opts.limit ?? 7); i++) {
    const day = addDays(opts.fromDay, i);
    if (opts.excludeDays?.includes(day) || noPlanDays.includes(isoWeekday(day))) continue;
    const from = zonedDate(day, window.from).getTime();
    const until = zonedDate(day, window.until).getTime();

    let start = Math.max(from, Math.ceil(earliest / STEP_MS) * STEP_MS);
    while (start + duration <= until) {
      const end = start + duration;
      const clash = busy.find((b) => b.start < end && b.end > start);
      if (!clash) {
        const slot = { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
        if (!opts.excludeStarts?.includes(slot.start)) {
          slots.push(slot);
          break;
        }
        start += STEP_MS;
      } else {
        // Jump past the event, back onto the half-hour grid.
        start = Math.ceil(clash.end / STEP_MS) * STEP_MS;
      }
    }
  }
  return slots;
}

/**
 * All free stretches of at least `minMinutes` on one day within [from, until],
 * longest first (for "you have 13:00–17:00 free"). Same rules as findSlots:
 * half-hour grid, margin around events, all-day events don't count.
 */
export async function freeBlocks(opts: { day: string; from: string; until: string; minMinutes: number }): Promise<Slot[]> {
  if (await isNoPlanDay(opts.day)) return [];
  const events = await listEvents(zonedDate(opts.day), zonedDate(addDays(opts.day, 1)));
  const margin = COACH.bufferMinutes * 60_000;
  const busy = events
    .filter((e) => !e.allDay)
    .map((e) => ({ start: Date.parse(e.startsAt) - margin, end: Date.parse(e.endsAt) + margin }))
    .sort((a, b) => a.start - b.start);
  const until = zonedDate(opts.day, opts.until).getTime();
  let cursor = Math.max(zonedDate(opts.day, opts.from).getTime(), Math.ceil((Date.now() + STEP_MS) / STEP_MS) * STEP_MS);

  const blocks: Slot[] = [];
  const add = (start: number, end: number) => {
    // Start on the grid, end on the grid: 13:10–16:50 becomes 13:30–16:30.
    const s = Math.ceil(start / STEP_MS) * STEP_MS;
    const e = Math.floor(end / STEP_MS) * STEP_MS;
    if (e - s >= opts.minMinutes * 60_000) blocks.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() });
  };
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start >= until) break;
    add(cursor, Math.min(b.start, until));
    cursor = Math.max(cursor, b.end);
  }
  add(cursor, until);
  return blocks.sort((a, b) => Date.parse(b.end) - Date.parse(b.start) - (Date.parse(a.end) - Date.parse(a.start)));
}

/** "2 u" or "1,5 u" */
export function slotHours(slot: Slot) {
  const hours = (Date.parse(slot.end) - Date.parse(slot.start)) / 3_600_000;
  return `${String(hours).replace(".", ",")} u`;
}

/** "wo 22 okt 07:00–08:00" (or "vandaag 07:00–08:00") */
export function formatSlot(slot: Slot) {
  const start = new Date(slot.start);
  const day = dayKey(start);
  const today = dayKey();
  const label =
    day === today
      ? "vandaag"
      : day === addDays(today, 1)
        ? "morgen"
        : new Intl.DateTimeFormat("nl-NL", { timeZone: TIMEZONE, weekday: "short", day: "numeric", month: "short" }).format(start);
  return `${label} ${timeKey(start)}–${timeKey(new Date(slot.end))}`;
}

/** Short button label: "do 07:00" */
export function shortSlot(slot: Slot) {
  const start = new Date(slot.start);
  const weekday = new Intl.DateTimeFormat("nl-NL", { timeZone: TIMEZONE, weekday: "short" }).format(start);
  return `${weekday} ${timeKey(start)}`;
}
