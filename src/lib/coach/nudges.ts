import { listEvents } from "@/lib/calendar/feeds";
import { listTasks } from "@/lib/ticktick/client";
import { addDays, dayKey, isoWeekday, timeKey, weekStart, zonedDate } from "@/lib/dates";
import { COACH, COACH_CALENDAR, GITLAB_NUDGE } from "@/lib/config";
import { formatDue } from "@/lib/telegram/quick";
import { weekProgress } from "./goals";
import { routineReminders } from "./routines";
import { focusSlot, focusSuggestion, focusTitle } from "./focus";
import { findSlots, formatSlot, freeBlocks } from "./slots";
import { getCoachPrefs } from "./prefs";
import { goalSuggestion, suggestionPayload, eveningCheck, morningCheckin, weeklyReview } from "./checkins";
import { ago, lastOwnCommit, milestoneLine, projectDeadlines, projectProgress } from "@/lib/gitlab/progress";
import { listTrackedProjects } from "@/lib/gitlab/sync";
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

    if (within(now, COACH.morning)) {
      await run("morning check-in", `morning:${today}`, morningCheckin);
      if ((await getCoachPrefs()).focusSuggestion) await run("focus suggestion", `focus:${today}`, focusSuggestion);
    }
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
 * reserved for it, a GitLab project going quiet while a milestone is near, or
 * a goal that's falling behind this week. One per check,
 * at most COACH.maxNudgesPerDay per day.
 */
export async function checkNudges() {
  const prefs = await getCoachPrefs();
  if ((await nudgesToday()).length >= prefs.maxNudgesPerDay) return;
  if (prefs.deadlineNudges && (await deadlineNudge())) return;
  if (prefs.projectNudges && (await projectNudge())) return;
  await goalNudge();
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

/** Something due soon: a TickTick task, or a GitLab milestone / own issue. */
type Due = { key: string; title: string; dueDay: string; dueTime: string | null; taskId?: string };

async function upcomingDeadlines(today: string, horizon: string): Promise<Due[]> {
  const [tasks, gitlab] = await Promise.all([listTasks().catch(() => null), projectDeadlines(horizon, addDays(today, 1))]);
  return [
    ...(tasks ?? [])
      .filter(
        (t) => t.dueDay && t.dueDay > today && t.dueDay <= horizon && !t.recurring && !(COACH.noBlockLists as readonly string[]).includes(t.list)
      )
      .map((t): Due => ({ key: `deadline:${t.id}`, title: t.title, dueDay: t.dueDay!, dueTime: t.dueTime, taskId: t.id })),
    // Overdue issues are left out: a block "before the deadline" no longer fits.
    ...gitlab
      .filter((d) => d.dueOn > today)
      .map((d): Due => ({ key: `deadline:gitlab:${d.id}`, title: `${d.project}: ${d.title}`, dueDay: d.dueOn, dueTime: null })),
  ].sort((a, b) => a.dueDay.localeCompare(b.dueDay));
}

async function deadlineNudge() {
  const today = dayKey();
  const horizon = addDays(today, COACH.deadlineDays);
  const upcoming = await upcomingDeadlines(today, horizon);
  if (upcoming.length === 0) return false;

  const coachEvents = (await listEvents(new Date(), zonedDate(addDays(horizon, 1)))).filter((e) => e.feed === COACH_CALENDAR);
  for (const due of upcoming) {
    if (await keyExists(due.key)) continue;
    // Already time reserved for it?
    const lower = due.title.toLowerCase();
    if (coachEvents.some((e) => e.title.toLowerCase().includes(lower))) continue;

    const untilDay = addDays(due.dueDay, -1);
    const days = Math.round((Date.parse(untilDay) - Date.parse(today)) / 86_400_000) + 1;
    const [slot] = await findSlots({ fromDay: today, days, durationMinutes: BLOCK_MINUTES, preferred: "any", limit: 1 });
    if (!slot) continue;
    const item = { title: `Werken aan: ${due.title}`, calendar: COACH_CALENDAR, slot, durationMinutes: BLOCK_MINUTES };
    const text = `⏰ "${due.title}" moet ${formatDue(due.dueDay, due.dueTime)} af en er staat nog geen tijd voor. Een uur ${formatSlot(slot)}?`;
    const sent = await sendPrompt({
      kind: "deadline",
      dedupKey: due.key,
      text,
      payload: { ...suggestionPayload(text, item, null, untilDay), taskId: due.taskId },
      buttons: suggestionButtons,
    });
    if (sent) return true;
  }
  return false;
}

/**
 * A followed project with a milestone due within GITLAB_NUDGE.milestoneDays
 * where Piet hasn't committed for GITLAB_NUDGE.staleDays: suggest a focus
 * block (the same "Focus: <project>" block as the daily focus suggestion).
 * Once per project per milestone.
 */
async function projectNudge() {
  const today = dayKey();
  const staleBefore = Date.now() - GITLAB_NUDGE.staleDays * 86_400_000;
  for (const project of await listTrackedProjects()) {
    const last = await lastOwnCommit(project.id);
    // Never committed: probably a project he only follows; no point nagging.
    if (!last || last.getTime() > staleBefore) continue;
    const progress = await projectProgress(project);
    const milestone = progress.milestones.find(
      (m) => m.dueOn && m.dueOn >= today && m.dueOn <= addDays(today, GITLAB_NUDGE.milestoneDays) && m.done < m.total
    );
    if (!milestone) continue;
    const key = `project:${project.id}:${milestone.title}`;
    if (await keyExists(key)) continue;

    const untilDay = addDays(milestone.dueOn!, -1);
    const days = Math.round((Date.parse(untilDay) - Date.parse(today)) / 86_400_000) + 1;
    let block = null;
    for (let i = 0; i < days && !block; i++) [block] = await freeBlocks({ day: addDays(today, i), ...COACH.focus });
    if (!block) continue;
    const slot = focusSlot(block);
    const minutes = Math.round((Date.parse(slot.end) - Date.parse(slot.start)) / 60_000);
    const item = { title: focusTitle(project.name), calendar: COACH_CALENDAR, slot, durationMinutes: minutes };
    const text = `🧭 ${project.name}: je laatste commit was ${ago(last)}, en ${milestoneLine(milestone)}. Een focusblok ${formatSlot(slot)}?`;
    const sent = await sendPrompt({
      kind: "project",
      dedupKey: key,
      text,
      payload: suggestionPayload(text, item, null, untilDay),
      buttons: suggestionButtons,
    });
    if (sent) return true;
  }
  return false;
}
