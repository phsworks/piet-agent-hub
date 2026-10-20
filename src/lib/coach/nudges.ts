import { listEvents } from "@/lib/calendar/feeds";
import { listTasks } from "@/lib/ticktick/client";
import { addDays, dayKey, isoWeekday, timeKey, weekStart, zonedDate } from "@/lib/dates";
import { COACH, COACH_CALENDAR } from "@/lib/config";
import { formatDue } from "@/lib/telegram/quick";
import { weekProgress } from "./goals";
import { findSlots, formatSlot } from "./slots";
import { routineReminders } from "./routines";
import { goalSuggestion, suggestionPayload, eveningCheck, morningCheckin, weeklyReview } from "./checkins";
import { goalsSuggestedToday, isCoachPaused, keyExists, nudgesToday, sendPrompt, suggestionButtons } from "./prompts";

// Work blocks for deadlines are an hour; Piet can pick another time.
const BLOCK_MINUTES = 60;
// Suggestions are checked at most this often (the tick itself runs more often).
const NUDGE_EVERY_MS = 60 * 60_000;

const state = ((globalThis as unknown as { __coach?: { lastNudgeCheck: number; running: boolean } }).__coach ??= {
  lastNudgeCheck: 0,
  running: false,
});

const within = (now: string, window: { from: string; until: string }) => now >= window.from && now < window.until;

/**
 * Runs every 10 minutes. Each check-in has a time window instead of an exact
 * time, so one missed while the Mac slept still goes out when it wakes; the
 * dedup key keeps it to once a day.
 */
export async function coachTick() {
  if (state.running || (await isCoachPaused())) return;
  state.running = true;
  try {
    const now = timeKey(new Date());
    const today = dayKey();
    const run = async (name: string, key: string, job: () => Promise<unknown>) => {
      if (await keyExists(key)) return;
      await job().catch((err) => console.error(`[coach] ${name} failed`, err));
    };

    if (within(now, COACH.morning)) await run("morning check-in", `morning:${today}`, morningCheckin);
    if (isoWeekday(today) === 7 && within(now, COACH.weekly)) await run("weekly review", `weekly:${today}`, weeklyReview);
    if (within(now, COACH.evening)) await run("evening check", `evening:${today}`, eveningCheck);

    // Piet's own reminder times (e.g. reading at 23:30), outside the quiet hours on purpose.
    await routineReminders().catch((err) => console.error("[coach] routine reminders failed", err));

    if (within(now, COACH.nudgeHours) && Date.now() - state.lastNudgeCheck >= NUDGE_EVERY_MS) {
      state.lastNudgeCheck = Date.now();
      await checkNudges().catch((err) => console.error("[coach] nudges failed", err));
    }
  } finally {
    state.running = false;
  }
}

/**
 * Event-driven suggestions, in code: a deadline coming up without time
 * reserved for it, or a goal that's falling behind this week. One per check,
 * at most COACH.maxNudgesPerDay per day.
 */
export async function checkNudges() {
  if ((await nudgesToday()).length >= COACH.maxNudgesPerDay) return;
  if ((await deadlineNudge()) || (await goalNudge())) return;
}

async function goalNudge() {
  const today = dayKey();
  const weekday = isoWeekday(today);
  const sunday = addDays(weekStart(today), 6);
  const daysLeft = 8 - weekday; // including today
  const suggested = await goalsSuggestedToday();

  for (const p of await weekProgress(today)) {
    if (!p.goal.durationMinutes || p.remaining === 0 || suggested.has(p.goal.id)) continue;
    // Behind: from Thursday on, or when the remaining days barely fit what's left.
    const behind = weekday >= 4 || p.remaining >= daysLeft - 1;
    if (!behind) continue;
    const item = await goalSuggestion(p, today, sunday);
    if (!item) continue;
    const text = `🎯 ${p.goal.title}: ${p.done} van ${p.goal.timesPerWeek} deze week${p.planned ? ` (${p.planned} gepland)` : ""}. Je hebt ${formatSlot(item.slot)} vrij. Zal ik het inplannen?`;
    // Once per week and progress level: after a session the next suggestion can come.
    const sent = await sendPrompt({
      kind: "goal",
      dedupKey: `goal:${p.goal.id}:${weekStart(today)}:${p.done + p.planned}`,
      text,
      goalId: p.goal.id,
      payload: suggestionPayload(text, item, p, sunday),
      buttons: suggestionButtons,
    });
    if (sent) return true;
  }
  return false;
}

async function deadlineNudge() {
  const tasks = await listTasks().catch(() => null);
  if (!tasks) return false;
  const today = dayKey();
  const horizon = addDays(today, COACH.deadlineDays);
  const upcoming = tasks.filter(
    (t) => t.dueDay && t.dueDay > today && t.dueDay <= horizon && !t.recurring && !(COACH.noBlockLists as readonly string[]).includes(t.list)
  );
  if (upcoming.length === 0) return false;

  const coachEvents = (await listEvents(new Date(), zonedDate(addDays(horizon, 1)))).filter((e) => e.feed === COACH_CALENDAR);
  for (const task of upcoming) {
    if (await keyExists(`deadline:${task.id}`)) continue;
    // Already time reserved for it?
    const lower = task.title.toLowerCase();
    if (coachEvents.some((e) => e.title.toLowerCase().includes(lower))) continue;

    const untilDay = addDays(task.dueDay!, -1);
    const days = Math.round((Date.parse(untilDay) - Date.parse(today)) / 86_400_000) + 1;
    const [slot] = await findSlots({ fromDay: today, days, durationMinutes: BLOCK_MINUTES, preferred: "any", limit: 1 });
    if (!slot) continue;
    const item = { title: `Werken aan: ${task.title}`, calendar: COACH_CALENDAR, slot, durationMinutes: BLOCK_MINUTES };
    const text = `⏰ "${task.title}" moet ${formatDue(task.dueDay, task.dueTime)} af en er staat nog geen tijd voor. Een uur ${formatSlot(slot)}?`;
    const sent = await sendPrompt({
      kind: "deadline",
      dedupKey: `deadline:${task.id}`,
      text,
      payload: { ...suggestionPayload(text, item, null, untilDay), taskId: task.id },
      buttons: suggestionButtons,
    });
    if (sent) return true;
  }
  return false;
}
