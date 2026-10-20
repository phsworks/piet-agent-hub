import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { coachPrompts } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import { createICloudEvent } from "@/lib/icloud/caldav";
import { dayKey, zonedDate } from "@/lib/dates";
import { sendButtons, type InlineButton } from "@/lib/telegram/api";
import type { Slot } from "./slots";

export type CoachPrompt = typeof coachPrompts.$inferSelect;

/** One thing to put in the calendar. */
export type PlanItem = {
  title: string;
  calendar: string;
  slot: Slot;
  goalId?: string;
  durationMinutes: number;
};

/** A "plan this?" message: ✓ Inplannen / Andere tijd / Overslaan. */
export type SuggestionPayload = {
  text: string;
  item: PlanItem;
  /** How to look for other times when Piet taps "Andere tijd". */
  search: { preferred: string; untilDay: string; excludeDays: string[] };
  alternatives?: Slot[];
};

export type WeeklyPayload = { text: string; plan: PlanItem[] };

export type CheckItem = {
  type: "goal" | "task";
  id: string;
  title: string;
  /** For tasks: their time, kept when moved to tomorrow. */
  dueTime?: string | null;
  state?: "done" | "not" | "moved";
};

export type EveningPayload = { text: string; items: CheckItem[] };

const PAUSED_KEY = "coach_paused";

export async function isCoachPaused() {
  return (await getSetting<boolean>(PAUSED_KEY)) === true;
}

export async function setCoachPaused(paused: boolean) {
  await setSetting(PAUSED_KEY, paused);
}

/**
 * Claims a dedup key and sends the message. Returns null when this key was
 * already sent (so every check-in or suggestion goes out at most once). If
 * sending fails the claim is released, so the next tick retries.
 */
export async function sendPrompt(opts: {
  kind: string;
  dedupKey: string;
  text: string;
  buttons: (id: string) => InlineButton[][];
  payload?: object;
  goalId?: string | null;
  day?: string;
}) {
  const [row] = await db
    .insert(coachPrompts)
    .values({
      kind: opts.kind,
      dedupKey: opts.dedupKey,
      payload: opts.payload ?? { text: opts.text },
      goalId: opts.goalId ?? null,
      day: opts.day ?? dayKey(),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return null;
  try {
    const messageId = await sendButtons(opts.text, opts.buttons(row.id));
    await db.update(coachPrompts).set({ messageId }).where(eq(coachPrompts.id, row.id));
    return row;
  } catch (err) {
    await db.delete(coachPrompts).where(eq(coachPrompts.id, row.id));
    throw err;
  }
}

/** Marks a dedup key as handled without sending anything (e.g. nothing to check tonight). */
export async function claimKey(kind: string, dedupKey: string) {
  const [row] = await db
    .insert(coachPrompts)
    .values({ kind, dedupKey, status: "skipped", day: dayKey() })
    .onConflictDoNothing()
    .returning({ id: coachPrompts.id });
  return Boolean(row);
}

export async function keyExists(dedupKey: string) {
  const [row] = await db.select({ id: coachPrompts.id }).from(coachPrompts).where(eq(coachPrompts.dedupKey, dedupKey));
  return Boolean(row);
}

export function suggestionButtons(id: string): InlineButton[][] {
  return [
    [
      { text: "✓ Inplannen", data: `c:${id}:ok` },
      { text: "Andere tijd", data: `c:${id}:alt` },
    ],
    [{ text: "Overslaan", data: `c:${id}:skip` }],
  ];
}

/** Suggestions sent today (for the daily maximum). */
export async function nudgesToday() {
  const rows = await db
    .select({ id: coachPrompts.id, goalId: coachPrompts.goalId })
    .from(coachPrompts)
    .where(and(inArray(coachPrompts.kind, ["goal", "deadline"]), gte(coachPrompts.createdAt, zonedDate(dayKey()))));
  return rows;
}

/** Goals that got any suggestion today (morning check-in included), so they aren't suggested twice. */
export async function goalsSuggestedToday() {
  const rows = await db
    .select({ goalId: coachPrompts.goalId })
    .from(coachPrompts)
    .where(and(inArray(coachPrompts.kind, ["goal", "morning"]), gte(coachPrompts.createdAt, zonedDate(dayKey()))));
  return new Set(rows.map((r) => r.goalId).filter(Boolean));
}

export async function planItem(item: PlanItem) {
  return createICloudEvent({
    calendar: item.calendar,
    title: item.title,
    start: new Date(item.slot.start),
    end: new Date(item.slot.end),
    alarmMinutes: 15,
  });
}

/** Ticks a routine off (or not) for a day; the evening check calls this. */
export async function logRoutine(goalId: string, day: string, status: "done" | "skipped") {
  await db
    .insert(coachPrompts)
    .values({ kind: "check", dedupKey: `check:${goalId}:${day}`, goalId, day, status })
    .onConflictDoUpdate({ target: coachPrompts.dedupKey, set: { status } });
}
