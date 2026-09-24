import cron from "node-cron";
import { BRIEFING_CRON, CALENDAR_SYNC_HOURS, TIMEZONE } from "@/lib/config";
import { listFeeds, syncFeeds } from "@/lib/calendar/feeds";
import { ensureBriefing } from "@/lib/briefing/generate";

// Survives dev hot reloads, so jobs are only scheduled once per process.
const state = ((globalThis as unknown as { __jobs?: { started: boolean } }).__jobs ??= { started: false });

async function syncCalendars() {
  await syncFeeds().catch((err) => console.error("Calendar sync failed", err));
}

async function writeBriefing() {
  await ensureBriefing().catch((err) => console.error("Daily briefing failed", err));
}

/** Called on server start: schedules recurring jobs and catches up on missed ones. */
export async function startJobs() {
  if (state.started) return;
  state.started = true;

  cron.schedule(`0 */${CALENDAR_SYNC_HOURS} * * *`, syncCalendars, { timezone: TIMEZONE });
  cron.schedule(BRIEFING_CRON, writeBriefing, { timezone: TIMEZONE });

  // Catch up: sync feeds that are stale, then make sure today's briefing
  // exists (it uses the fresh schedule).
  const staleBefore = Date.now() - CALENDAR_SYNC_HOURS * 3_600_000;
  const feeds = await listFeeds();
  if (feeds.some((f) => !f.lastSyncedAt || Date.parse(f.lastSyncedAt) < staleBefore)) {
    await syncCalendars();
  }
  await writeBriefing();
}
