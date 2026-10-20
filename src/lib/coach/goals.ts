import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { coachPrompts, goals } from "@/lib/db/schema";
import { listEvents, type CalendarEvent } from "@/lib/calendar/feeds";
import { addDays, dayKey, weekStart, zonedDate } from "@/lib/dates";
import { COACH_CALENDAR, DAY_PARTS } from "@/lib/config";

export type Goal = typeof goals.$inferSelect;
export type DayPart = keyof typeof DAY_PARTS;

export const DAY_PART_LABELS: Record<DayPart, string> = {
  morning: "'s ochtends",
  afternoon: "'s middags",
  evening: "'s avonds",
  any: "wanneer het past",
};

export function isDayPart(value: unknown): value is DayPart {
  return typeof value === "string" && value in DAY_PARTS;
}

export async function listGoals() {
  return db.select().from(goals).where(eq(goals.active, true)).orderBy(goals.createdAt);
}

export async function getGoal(id: string) {
  const [goal] = await db.select().from(goals).where(eq(goals.id, id));
  return goal ?? null;
}

async function findGoal(title: string) {
  const [goal] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.active, true), sql`lower(${goals.title}) = ${title.trim().toLowerCase()}`));
  return goal ?? null;
}

/** Creates a goal, or updates the one with the same title. */
export async function saveGoal(input: {
  title: string;
  timesPerWeek?: number;
  durationMinutes?: number | null;
  calendar?: string;
  preferred?: DayPart;
  match?: string[];
  days?: number[];
  remindAt?: string | null;
}) {
  const title = input.title.trim();
  // The goal's own name always counts: an event "Hardlopen" counts for "Hardlopen".
  const match = [...new Set([title, ...(input.match ?? [])].map((w) => w.trim().toLowerCase()).filter(Boolean))];
  const existing = await findGoal(title);
  if (existing) {
    const [updated] = await db
      .update(goals)
      .set({
        ...(input.timesPerWeek !== undefined && { timesPerWeek: input.timesPerWeek }),
        ...(input.durationMinutes !== undefined && { durationMinutes: input.durationMinutes }),
        ...(input.calendar && { calendar: input.calendar }),
        ...(input.preferred && { preferred: input.preferred }),
        ...(input.match && { match }),
        ...(input.days && { days: input.days }),
        ...(input.remindAt !== undefined && { remindAt: input.remindAt }),
      })
      .where(eq(goals.id, existing.id))
      .returning();
    return { goal: updated, action: "updated" as const };
  }
  const [created] = await db
    .insert(goals)
    .values({
      title,
      timesPerWeek: input.timesPerWeek ?? 1,
      durationMinutes: input.durationMinutes ?? null,
      calendar: input.calendar ?? COACH_CALENDAR,
      preferred: input.preferred ?? "any",
      match,
      days: input.days ?? [],
      remindAt: input.remindAt ?? null,
    })
    .returning();
  return { goal: created, action: "created" as const };
}

export async function removeGoal(title: string) {
  const goal = await findGoal(title);
  if (!goal) return null;
  await db.delete(goals).where(eq(goals.id, goal.id));
  return goal;
}

export function matchesGoal(goal: Goal, title: string) {
  const lower = title.toLowerCase();
  return goal.match.some((word) => lower.includes(word));
}

export type GoalProgress = {
  goal: Goal;
  /** Sessions that already happened (past matching events + ticked off routines). */
  done: number;
  /** Matching events still to come this week. */
  planned: number;
  /** Sessions still missing to reach the target, after counting planned ones. */
  remaining: number;
  /** Days (YYYY-MM-DD) this week that already have a session or plan. */
  busyDays: string[];
};

/** Progress for every active goal in the week (Mon–Sun) that `day` falls in. */
export async function weekProgress(day = dayKey()): Promise<GoalProgress[]> {
  const list = await listGoals();
  if (list.length === 0) return [];
  const monday = weekStart(day);
  const nextMonday = addDays(monday, 7);
  const now = new Date();
  const [events, checks] = await Promise.all([
    listEvents(zonedDate(monday), zonedDate(nextMonday)),
    db
      .select({ goalId: coachPrompts.goalId, day: coachPrompts.day })
      .from(coachPrompts)
      .where(
        and(
          inArray(coachPrompts.goalId, list.map((g) => g.id)),
          eq(coachPrompts.status, "done"),
          gte(coachPrompts.day, monday),
          lt(coachPrompts.day, nextMonday)
        )
      ),
  ]);
  return list.map((goal) => progressFor(goal, events, checks, now));
}

function progressFor(
  goal: Goal,
  events: CalendarEvent[],
  checks: { goalId: string | null; day: string | null }[],
  now: Date
): GoalProgress {
  const sessions = events.filter((e) => !e.allDay && matchesGoal(goal, e.title));
  const past = sessions.filter((e) => new Date(e.endsAt) <= now);
  const ticked = checks.filter((c) => c.goalId === goal.id);
  const done = past.length + ticked.length;
  const planned = sessions.length - past.length;
  const busyDays = [
    ...new Set([...sessions.map((e) => dayKey(new Date(e.startsAt))), ...ticked.map((c) => c.day!)]),
  ];
  return { goal, done, planned, remaining: Math.max(goal.timesPerWeek - done - planned, 0), busyDays };
}

/** "Hardlopen 1/2 (+1 gepland)" */
export function progressLine(p: GoalProgress) {
  const extra = p.planned ? ` (+${p.planned} gepland)` : "";
  const mark = p.done >= p.goal.timesPerWeek ? " ✅" : "";
  return `${p.goal.title} ${p.done}/${p.goal.timesPerWeek}${extra}${mark}`;
}

const WEEKDAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];

export function weekdayNames(days: number[]) {
  return days.map((d) => WEEKDAYS[d - 1]).join("/");
}

export function describeGoal(goal: Goal) {
  const freq = goal.timesPerWeek >= 7 ? "dagelijks" : `${goal.timesPerWeek}× per week`;
  const parts = [freq];
  if (goal.days.length) parts.push(`liefst ${weekdayNames(goal.days)}`);
  if (goal.durationMinutes) parts.push(`${goal.durationMinutes} min`, DAY_PART_LABELS[goal.preferred as DayPart] ?? "", `in ${goal.calendar}`);
  else if (goal.remindAt) parts.push(`seintje om ${goal.remindAt}`);
  else parts.push("afvinken 's avonds");
  return `${goal.title}: ${parts.filter(Boolean).join(", ")}`;
}
