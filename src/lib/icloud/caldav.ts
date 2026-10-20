import ICAL from "ical.js";
import { createDAVClient, type DAVCalendar } from "tsdav";
import { and, eq, like, notInArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { calendarEvents } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import { parseFeed, replaceEvents, syncWindow } from "@/lib/calendar/feeds";
import { dayKey } from "@/lib/dates";

// iCloud over CalDAV with an app-specific password (appleid.apple.com), so it
// works from any server. Apple Reminders is NOT reachable this way: upgraded
// reminders only show up as a "Reminders ⚠️" placeholder list.
const SERVER = "https://caldav.icloud.com";
const STATE_KEY = "icloud_sync";
const FEED_PREFIX = "icloud:";

type SyncState = {
  /** Calendar url → ctag at the last sync; an unchanged ctag means nothing changed. */
  ctags: Record<string, string>;
  lastSyncedAt: string | null;
  lastError: string | null;
};

type Client = Awaited<ReturnType<typeof createDAVClient>>;

// Logging in costs a few requests (discovery), so the client is reused.
const state = ((globalThis as unknown as { __icloud?: { client: Promise<Client> | null } }).__icloud ??= {
  client: null,
});

export function isICloudConfigured() {
  return Boolean(process.env.ICLOUD_USERNAME && process.env.ICLOUD_APP_PASSWORD);
}

async function client() {
  if (!isICloudConfigured()) throw new Error("ICLOUD_USERNAME / ICLOUD_APP_PASSWORD are not set in .env.local");
  state.client ??= createDAVClient({
    serverUrl: SERVER,
    credentials: { username: process.env.ICLOUD_USERNAME, password: process.env.ICLOUD_APP_PASSWORD },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  }).catch((err) => {
    state.client = null;
    throw err;
  });
  return state.client;
}

function nameOf(calendar: DAVCalendar) {
  return typeof calendar.displayName === "string" ? calendar.displayName : "Calendar";
}

/** Event calendars only: the placeholder reminders list holds VTODOs. */
async function eventCalendars() {
  const calendars = await (await client()).fetchCalendars();
  return calendars.filter((c) => !c.components || c.components.includes("VEVENT"));
}

export async function listICloudCalendars() {
  return (await eventCalendars()).map((c) => ({ name: nameOf(c), url: c.url }));
}

async function syncCalendar(calendar: DAVCalendar) {
  const { from, to } = syncWindow();
  const objects = await (await client()).fetchCalendarObjects({
    calendar,
    timeRange: { start: from.toISOString(), end: to.toISOString() },
  });
  const events = objects.flatMap((o) => {
    if (typeof o.data !== "string") return [];
    try {
      return parseFeed(o.data, from, to).map((e) => ({ ...e, calendar: nameOf(calendar), href: o.url }));
    } catch (err) {
      console.error(`[icloud] skipping unreadable event ${o.url}`, err);
      return [];
    }
  });
  return replaceEvents(FEED_PREFIX + calendar.url, events);
}

/**
 * Syncs every iCloud calendar whose ctag changed (or all with `force`).
 * Errors are stored in the sync state, not thrown, so a cron run never crashes.
 */
export async function syncICloud(opts: { force?: boolean; onlyUrl?: string } = {}) {
  if (!isICloudConfigured()) return { synced: 0 };
  const saved = (await getSetting<SyncState>(STATE_KEY)) ?? { ctags: {}, lastSyncedAt: null, lastError: null };
  try {
    const calendars = await eventCalendars();
    let synced = 0;
    for (const calendar of calendars) {
      if (opts.onlyUrl && calendar.url !== opts.onlyUrl) continue;
      const unchanged = calendar.ctag && saved.ctags[calendar.url] === calendar.ctag;
      if (unchanged && !opts.force) continue;
      await syncCalendar(calendar);
      if (calendar.ctag) saved.ctags[calendar.url] = calendar.ctag;
      synced++;
    }
    // Events of calendars that were deleted in iCloud.
    if (!opts.onlyUrl) {
      await db.delete(calendarEvents).where(
        and(
          like(calendarEvents.feedId, `${FEED_PREFIX}%`),
          notInArray(calendarEvents.feedId, calendars.map((c) => FEED_PREFIX + c.url).concat([""]))
        )
      );
    }
    saved.lastSyncedAt = new Date().toISOString();
    saved.lastError = null;
    await setSetting(STATE_KEY, saved);
    return { synced };
  } catch (err) {
    console.error("[icloud] sync failed", err);
    saved.lastError = err instanceof Error ? err.message : String(err);
    await setSetting(STATE_KEY, saved);
    return { synced: 0, error: saved.lastError };
  }
}

export async function getICloudStatus() {
  const saved = await getSetting<SyncState>(STATE_KEY);
  return {
    configured: isICloudConfigured(),
    lastSyncedAt: saved?.lastSyncedAt ?? null,
    lastError: saved?.lastError ?? null,
  };
}

/** Finds a calendar by name (case-insensitive), creating it when it doesn't exist. */
async function ensureCalendar(name: string) {
  const find = (list: DAVCalendar[]) => list.find((c) => nameOf(c).toLowerCase() === name.toLowerCase());
  const calendars = await eventCalendars();
  const existing = find(calendars);
  if (existing) return existing;
  if (!calendars[0]) throw new Error("No iCloud calendars found");

  // Calendars live side by side in the calendar home: .../calendars/<id>/
  const home = calendars[0].url.replace(/[^/]+\/$/, "");
  await (await client()).makeCalendar({
    url: `${home}${crypto.randomUUID()}/`,
    props: {
      "d:displayname": name,
      "c:supported-calendar-component-set": { "c:comp": { _attributes: { name: "VEVENT" } } },
    },
  });
  const created = find(await eventCalendars());
  if (!created) throw new Error(`Couldn't create the calendar "${name}" in iCloud`);
  return created;
}

function escapeText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icalUtc(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icalDay(day: string) {
  return day.replace(/-/g, "");
}

export type NewEvent = {
  calendar: string;
  title: string;
  start: Date;
  end: Date;
  /** For all-day events: YYYY-MM-DD of the first and last day. */
  allDayRange?: { first: string; afterLast: string };
  location?: string | null;
  notes?: string | null;
  /** Minutes before the start for a notification; null for none. */
  alarmMinutes?: number | null;
};

export async function createICloudEvent(input: NewEvent) {
  const calendar = await ensureCalendar(input.calendar);
  const uid = crypto.randomUUID();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Piet's Brain//NL",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icalUtc(new Date())}`,
    ...(input.allDayRange
      ? [`DTSTART;VALUE=DATE:${icalDay(input.allDayRange.first)}`, `DTEND;VALUE=DATE:${icalDay(input.allDayRange.afterLast)}`]
      : [`DTSTART:${icalUtc(input.start)}`, `DTEND:${icalUtc(input.end)}`]),
    `SUMMARY:${escapeText(input.title)}`,
    ...(input.location ? [`LOCATION:${escapeText(input.location)}`] : []),
    ...(input.notes ? [`DESCRIPTION:${escapeText(input.notes)}`] : []),
    ...(input.alarmMinutes != null
      ? ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(input.title)}`, `TRIGGER:-PT${input.alarmMinutes}M`, "END:VALARM"]
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const res = await (await client()).createCalendarObject({
    calendar,
    filename: `${uid}.ics`,
    iCalString: lines.join("\r\n"),
  });
  if (!res.ok) throw new Error(`iCloud refused the event: ${res.status} ${res.statusText}`);
  await syncICloud({ force: true, onlyUrl: calendar.url });
  return { calendar: nameOf(calendar) };
}

/** A stored event that can be changed: single (non-recurring) iCloud events only. */
async function editableEvent(eventId: string) {
  const [row] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId));
  if (!row) throw new Error("No event with that id (the calendar may have just refreshed; list it again).");
  if (!row.href || !row.feedId.startsWith(FEED_PREFIX)) throw new Error("This event comes from a read-only feed.");
  if (row.recurring) throw new Error("This is a recurring event; change it in the calendar app.");
  const calendarUrl = row.feedId.slice(FEED_PREFIX.length);
  const calendar = (await eventCalendars()).find((c) => c.url === calendarUrl);
  if (!calendar) throw new Error("The calendar of this event no longer exists.");
  return { row, calendar, href: row.href };
}

export async function moveICloudEvent(eventId: string, start: Date, end: Date) {
  const { row, calendar, href } = await editableEvent(eventId);
  const dav = await client();
  const [object] = await dav.fetchCalendarObjects({ calendar, objectUrls: [href] });
  if (!object?.data) throw new Error("The event no longer exists in iCloud.");

  const root = new ICAL.Component(ICAL.parse(object.data));
  const vevent = root.getFirstSubcomponent("vevent");
  if (!vevent) throw new Error("The event has no VEVENT.");
  const event = new ICAL.Event(vevent);
  if (event.startDate.isDate) {
    // All-day stays all-day: DTEND is the day after the last day.
    event.startDate = ICAL.Time.fromDateString(dayKey(start));
    event.endDate = ICAL.Time.fromDateString(dayKey(end));
  } else {
    event.startDate = ICAL.Time.fromJSDate(start, true);
    event.endDate = ICAL.Time.fromJSDate(end, true);
  }
  vevent.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));

  const res = await dav.updateCalendarObject({ calendarObject: { url: href, etag: object.etag, data: root.toString() } });
  if (!res.ok) throw new Error(`iCloud refused the change: ${res.status} ${res.statusText}`);
  await syncICloud({ force: true, onlyUrl: calendar.url });
  return { title: row.title, calendar: row.calendar };
}

export async function deleteICloudEvent(eventId: string) {
  const { row, calendar, href } = await editableEvent(eventId);
  const res = await (await client()).deleteCalendarObject({ calendarObject: { url: href } });
  if (!res.ok && res.status !== 404) throw new Error(`iCloud refused the delete: ${res.status} ${res.statusText}`);
  await syncICloud({ force: true, onlyUrl: calendar.url });
  return { title: row.title, calendar: row.calendar };
}
