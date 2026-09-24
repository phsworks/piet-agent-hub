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
