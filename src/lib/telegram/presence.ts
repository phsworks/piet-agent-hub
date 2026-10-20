import { getSetting, setSetting } from "@/lib/settings";
import { TIMEZONE } from "@/lib/config";
import { notifyOwner } from "./api";

const HEARTBEAT_KEY = "telegram_last_heartbeat";
const HEARTBEAT_MS = 60_000;
// Shorter gaps are restarts or deploys, not worth a message.
const OFFLINE_THRESHOLD_MS = 5 * 60_000;

/**
 * Writes a heartbeat every minute. A large gap since the last one means the
 * app was off or the Mac was asleep (timers don't fire during sleep), so Piet
 * gets a "back online" message. Checked on startup and on every tick.
 */
export async function startPresence() {
  await beat();
  setInterval(() => beat().catch((err) => console.error("[telegram] heartbeat failed", err)), HEARTBEAT_MS);
}

async function beat() {
  const now = Date.now();
  const last = await getSetting<number>(HEARTBEAT_KEY);
  await setSetting(HEARTBEAT_KEY, now);
  if (last && now - last > OFFLINE_THRESHOLD_MS) {
    await notifyOwner(`🟢 Weer online. Ik was offline van ${formatTime(last)} tot ${formatTime(now)}; berichten uit die tijd beantwoord ik nu.`);
  }
}

function formatTime(ms: number) {
  const date = new Date(ms);
  const sameDay =
    new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(date) ===
    new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: TIMEZONE,
    ...(sameDay ? {} : { weekday: "short", day: "numeric", month: "short" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
