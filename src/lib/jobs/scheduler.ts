import cron from "node-cron";
import { CALENDAR_SYNC_HOURS, GITLAB_SYNC_MINUTES, ICLOUD_SYNC_MINUTES, TIMEZONE } from "@/lib/config";
import { listFeeds, syncFeeds } from "@/lib/calendar/feeds";
import { syncICloud } from "@/lib/icloud/caldav";
import { syncGitLab } from "@/lib/gitlab/sync";
import { coachTick } from "@/lib/coach/nudges";
import { BACKUP_STALE_MS, backupsEnabled, lastBackupAt, runBackup } from "./backup";

// Survives dev hot reloads, so jobs are only scheduled once per process.
const state = ((globalThis as unknown as { __jobs?: { started: boolean } }).__jobs ??= { started: false });

async function syncCalendars() {
  await syncFeeds().catch((err) => console.error("Calendar sync failed", err));
}

/** Called on server start: schedules recurring jobs and catches up on missed ones. */
export async function startJobs() {
  if (state.started) return;
  state.started = true;

  cron.schedule(`0 */${CALENDAR_SYNC_HOURS} * * *`, syncCalendars, { timezone: TIMEZONE });
  // Unchanged iCloud calendars are skipped (ctag), so this is a single request most of the time.
  cron.schedule(`*/${ICLOUD_SYNC_MINUTES} * * * *`, () => syncICloud(), { timezone: TIMEZONE });
  // Incremental (updated_after), so a quiet project costs four small requests.
  cron.schedule(`*/${GITLAB_SYNC_MINUTES} * * * *`, () => syncGitLab(), { timezone: TIMEZONE });
  if (backupsEnabled()) cron.schedule("30 3 * * *", runBackup, { timezone: TIMEZONE });
  // Coach check-ins and suggestions; each decides itself whether it's time (see coachTick).
  cron.schedule("*/10 * * * *", () => coachTick().catch((err) => console.error("[coach] tick failed", err)), {
    timezone: TIMEZONE,
  });

  // Catch up: iCloud and GitLab always (cheap), feeds when they went stale while the app was off.
  await syncICloud();
  await syncGitLab();
  const staleBefore = Date.now() - CALENDAR_SYNC_HOURS * 3_600_000;
  const feeds = await listFeeds();
  if (feeds.some((f) => !f.lastSyncedAt || Date.parse(f.lastSyncedAt) < staleBefore)) {
    await syncCalendars();
  }
  if (backupsEnabled()) {
    const last = await lastBackupAt();
    if (!last || Date.now() - Date.parse(last) > BACKUP_STALE_MS) await runBackup();
  }
  // After the calendar is fresh, so a catch-up check-in sees today's events.
  await coachTick().catch((err) => console.error("[coach] tick failed", err));
}
