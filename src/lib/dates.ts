import { TIMEZONE } from "@/lib/config";

/** YYYY-MM-DD for a moment, in Piet's timezone. */
export function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(date);
}

/** YYYY-MM-DD `days` after a YYYY-MM-DD key. */
export function addDays(key: string, days: number) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** HH:mm for a moment, in Piet's timezone. */
export function timeKey(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** Piet's UTC offset (ms) at a moment, e.g. +2h in summer. */
function offsetAt(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** Piet's current UTC offset in minutes (60 in winter, 120 in summer). */
export function utcOffsetMinutes(date = new Date()) {
  return offsetAt(date) / 60_000;
}

/**
 * The moment a local date and time (YYYY-MM-DD, HH:mm) is in Piet's timezone,
 * independent of the server's own timezone (the VPS runs in UTC).
 */
export function zonedDate(day: string, time = "00:00") {
  const [y, m, d] = day.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, h, min);
  let instant = wallAsUtc - offsetAt(new Date(wallAsUtc));
  // Second pass for moments next to a DST switch.
  instant = wallAsUtc - offsetAt(new Date(instant));
  return new Date(instant);
}

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 1 = Monday … 7 = Sunday for a YYYY-MM-DD key. */
export function isoWeekday(day: string) {
  return new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
}

/** The Monday of the week a YYYY-MM-DD key falls in. */
export function weekStart(day: string) {
  return addDays(day, 1 - isoWeekday(day));
}
