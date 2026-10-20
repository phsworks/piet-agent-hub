import * as chrono from "chrono-node";
import { TIMEZONE } from "@/lib/config";
import { dayKey, timeKey, utcOffsetMinutes, zonedDate } from "@/lib/dates";
import { listEvents } from "@/lib/calendar/feeds";
import { listTasks } from "@/lib/ticktick/client";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "/t morgen 9:00 mail docent" → title + due date/time, parsed in code (no AI).
 * Without a recognisable date the task goes in undated.
 */
export function parseQuickTask(input: string) {
  // chrono doesn't know the Dutch "14u" shorthand.
  const text = input.replace(/\b(\d{1,2})u\b/gi, "$1:00");
  // "morgen" relative to Piet's day, also on a server running in UTC.
  const [match] = chrono.nl.parse(text, { instant: new Date(), timezone: utcOffsetMinutes() }, { forwardDate: true });
  if (!match) return { title: input.trim(), dueDay: null, dueTime: null };

  const s = match.start;
  const dueDay = `${s.get("year")}-${pad(s.get("month")!)}-${pad(s.get("day")!)}`;
  const dueTime = s.isCertain("hour") ? `${pad(s.get("hour")!)}:${pad(s.get("minute") ?? 0)}` : null;
  const title = (text.slice(0, match.index) + text.slice(match.index + match.text.length))
    .replace(/\s+/g, " ")
    .replace(/^\s*(om|op)\s+/i, "")
    .trim();
  return { title: title || input.trim(), dueDay, dueTime };
}

/** "di 21 okt 09:00" */
export function formatDue(dueDay: string | null, dueTime: string | null) {
  if (!dueDay) return "zonder datum";
  const label = new Intl.DateTimeFormat("nl-NL", {
    timeZone: TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(zonedDate(dueDay, "12:00"));
  return dueTime ? `${label} ${dueTime}` : label;
}

const addDays = (day: string, n: number) => dayKey(new Date(zonedDate(day, "12:00").getTime() + n * 86_400_000));

function eventLine(e: { allDay: boolean; startsAt: string; endsAt: string; title: string; feed: string | null }) {
  const time = e.allDay ? "hele dag" : `${timeKey(new Date(e.startsAt))}–${timeKey(new Date(e.endsAt))}`;
  return `- ${time} ${e.title}${e.feed ? ` (${e.feed})` : ""}`;
}

function taskLine(t: { title: string; list: string; dueTime: string | null }, when?: string) {
  const label = when ?? t.dueTime ?? "";
  return `- ${t.title}${label ? ` (${label})` : ""}${t.list !== "Inbox" ? ` · ${t.list}` : ""}`;
}

/** Today's agenda and tasks as one plain message, without AI. */
export async function todayOverview() {
  const today = dayKey(new Date());
  const [events, tasks] = await Promise.all([
    listEvents(zonedDate(today), zonedDate(today, "23:59")),
    listTasks().catch(() => null),
  ]);

  const lines: string[] = [`📅 Vandaag, ${formatDue(today, null)}`];
  if (events.length === 0) lines.push("Geen afspraken.");
  lines.push(...events.map(eventLine));

  if (tasks === null) {
    lines.push("", "TickTick is niet gekoppeld (Settings).");
  } else {
    const due = tasks.filter((t) => t.dueDay && t.dueDay <= today);
    lines.push("", due.length ? "✅ Taken" : "✅ Geen taken voor vandaag.");
    lines.push(...due.map((t) => taskLine(t, t.dueDay! < today ? "te laat" : undefined)));
  }
  return lines.join("\n");
}

/** The coming 7 days per day (events and tasks), plus overdue tasks, without AI. */
export async function weekOverview() {
  const today = dayKey(new Date());
  const last = addDays(today, 6);
  const [events, tasks] = await Promise.all([
    listEvents(zonedDate(today), zonedDate(last, "23:59")),
    listTasks().catch(() => null),
  ]);

  const lines: string[] = [`🗓 Komende week, t/m ${formatDue(last, null)}`];
  const overdue = tasks?.filter((t) => t.dueDay && t.dueDay < today) ?? [];
  if (overdue.length) lines.push("", "⚠️ Te laat", ...overdue.map((t) => taskLine(t, formatDue(t.dueDay, null))));

  for (let i = 0; i < 7; i++) {
    const day = addDays(today, i);
    const dayEvents = events.filter((e) => dayKey(new Date(e.startsAt)) === day);
    const dayTasks = tasks?.filter((t) => t.dueDay === day) ?? [];
    if (!dayEvents.length && !dayTasks.length) continue;
    lines.push("", `${i === 0 ? "Vandaag" : i === 1 ? "Morgen" : formatDue(day, null)}`);
    lines.push(...dayEvents.map(eventLine), ...dayTasks.map((t) => taskLine(t).replace(/^- /, "- ☐ ")));
  }
  if (lines.length === 1) lines.push("Niets gepland. 🌴");
  if (tasks === null) lines.push("", "TickTick is niet gekoppeld (Settings).");
  return lines.join("\n");
}
