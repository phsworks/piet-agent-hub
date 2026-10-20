import { listEvents } from "@/lib/calendar/feeds";
import { addDays, dayKey, timeKey, zonedDate } from "@/lib/dates";
import { COACH, DAY_PARTS, TIMEZONE } from "@/lib/config";
import type { DayPart } from "./goals";

export type Slot = { start: string; end: string };

// Slots start on the hour or half hour; nobody plans a run at 07:13.
const STEP_MS = 30 * 60_000;

/**
 * Free time in Piet's calendar, found in code (no AI): per day, the window of
 * the preferred day part minus his events (with a margin around them). At most
 * one slot per day, the earliest that fits, so suggestions spread over the week.
 * All-day events (reminders, holidays) don't block time.
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
    if (opts.excludeDays?.includes(day)) continue;
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
