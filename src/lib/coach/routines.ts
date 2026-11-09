import { listEvents } from "@/lib/calendar/feeds";
import { dayKey, isoWeekday, timeKey, weekStart, zonedDate } from "@/lib/dates";
import { isNoPlanDay } from "./slots";
import { weekProgress, type GoalProgress } from "./goals";
import { keyExists, sendPrompt } from "./prompts";
import type { InlineButton } from "@/lib/telegram/api";

// remind_at is the start of a window: each day the message comes at a random
// moment within this many minutes after it, so it doesn't feel like an alarm.
const JITTER_MINUTES = 30;
// After its moment a reminder can still go out this long (the Mac may have been
// asleep), but never after midnight.
const WINDOW_MINUTES = 45;
// Tips on other days only when the evening is free from this time on.
const FREE_EVENING_FROM = "20:00";

const DAY_NAMES = ["Maandagavond", "Dinsdagavond", "Woensdagavond", "Donderdagavond", "Vrijdagavond", "Zaterdagavond", "Zondagavond"];

/** A stable "random" 0…1 per goal and day: the same on every tick, different every day. */
function dailyRandom(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
}

// Small variations so the messages don't read like a template.
const OPENERS = ["Tijd om nog even te", "Zin om nog even te", "Nog een kwartiertje", "Voor het slapen nog even"];
const pick = <T,>(list: T[], seed: string) => list[Math.floor(dailyRandom(seed) * list.length)];

function addMinutes(time: string, minutes: number) {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export type RoutinePayload = { text: string; goalId: string };

export function routineButtons(id: string): InlineButton[][] {
  return [
    [
      { text: "✓ Gedaan", data: `c:${id}:d` },
      { text: "Niet vandaag", data: `c:${id}:n` },
    ],
  ];
}

/**
 * Routines with a reminder time (e.g. reading at 23:30). On their own days a
 * reminder; on other days, at most once a week, a light tip when the evening
 * is free: from Wednesday when behind, or on Sunday as a bonus.
 */
export async function routineReminders() {
  const now = new Date();
  const today = dayKey(now);
  const time = timeKey(now);
  const weekday = isoWeekday(today);

  const due = (await weekProgress(today)).filter((p) => {
    if (!p.goal.remindAt || p.busyDays.includes(today)) return false;
    const at = addMinutes(p.goal.remindAt, Math.floor(dailyRandom(`${p.goal.id}:${today}`) * JITTER_MINUTES));
    return time >= at && time <= addMinutes(at, WINDOW_MINUTES);
  });
  for (const p of due) {
    const { goal } = p;
    const planned = goal.days.length === 0 || goal.days.includes(weekday);
    const status = `${p.done} van ${goal.timesPerWeek} deze week`;

    if (planned) {
      const opener = pick(OPENERS, `${goal.id}:${today}:text`);
      const ask = `${opener} ${verb(goal.title)}?`;
      const text = `📖 ${DAY_NAMES[weekday - 1]}. ${ask} (${status})`;
      await send(p, `routine:${goal.id}:${today}`, text);
      continue;
    }

    const tipKey = `tip:${goal.id}:${weekStart(today)}`;
    if (await keyExists(tipKey)) continue;
    const behind = p.done < goal.timesPerWeek;
    if (!(behind ? weekday >= 3 : weekday === 7)) continue;
    if (await isNoPlanDay(today)) continue;
    if (!(await freeEvening(today))) continue;
    const text = behind
      ? `📖 Je hebt vanavond niks meer staan. Zin om nog even te ${verb(goal.title)}? Dan zit je op ${p.done + 1} van ${goal.timesPerWeek}.`
      : `📖 Rustige ${DAY_NAMES[weekday - 1].toLowerCase()}. Je doel heb je al gehaald, maar nog even ${verb(goal.title)} voor het slapen is een mooie afsluiter.`;
    await send(p, tipKey, text);
  }
}

/** "Lezen" → "lezen" as a verb in "tijd om nog even te lezen". */
function verb(title: string) {
  return title.toLowerCase();
}

async function freeEvening(day: string) {
  const events = await listEvents(zonedDate(day, FREE_EVENING_FROM), zonedDate(day, "23:59"));
  return events.every((e) => e.allDay);
}

async function send(p: GoalProgress, dedupKey: string, text: string) {
  const payload: RoutinePayload = { text, goalId: p.goal.id };
  await sendPrompt({ kind: "routine", dedupKey, text, goalId: p.goal.id, payload, buttons: routineButtons });
}
