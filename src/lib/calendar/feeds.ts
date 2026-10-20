import ICAL from "ical.js";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { calendarEvents } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/settings";

export type CalendarFeed = {
  id: string;
  name: string;
  url: string;
  lastSyncedAt: string | null;
  lastError: string | null;
};

const FEEDS_KEY = "ical_feeds";
// Only events in this window are stored; everything else is refetched later.
const SYNC_PAST_DAYS = 1;
const SYNC_FUTURE_DAYS = 90;
// Guard against runaway recurrence rules (e.g. a daily rule from years ago).
const MAX_OCCURRENCES = 5_000;

export async function listFeeds() {
  return (await getSetting<CalendarFeed[]>(FEEDS_KEY)) ?? [];
}

async function saveFeeds(feeds: CalendarFeed[]) {
  await setSetting(FEEDS_KEY, feeds);
}

export async function addFeed(name: string, url: string) {
  const feed: CalendarFeed = {
    id: crypto.randomUUID(),
    name: name.trim() || "Calendar",
    url: url.trim(),
    lastSyncedAt: null,
    lastError: null,
  };
  await saveFeeds([...(await listFeeds()), feed]);
  return feed;
}

export async function removeFeed(id: string) {
  await saveFeeds((await listFeeds()).filter((f) => f.id !== id));
  await db.delete(calendarEvents).where(eq(calendarEvents.feedId, id));
}

export type ParsedEvent = Omit<typeof calendarEvents.$inferInsert, "id" | "feedId">;

/** Expands a feed's events (including recurring ones) that overlap [from, to). */
export function parseFeed(text: string, from: Date, to: Date): ParsedEvent[] {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents("vtimezone")) {
    ICAL.TimezoneService.register(tz);
  }

  const vevents = root.getAllSubcomponents("vevent");
  const masters = vevents.filter((v) => !v.hasProperty("recurrence-id"));
  const exceptions = vevents.filter((v) => v.hasProperty("recurrence-id"));
  const masterUids = new Set(masters.map((v) => v.getFirstPropertyValue("uid")));

  const out: ParsedEvent[] = [];
  const push = (
    uid: string,
    key: string,
    summary: string,
    location: string | null,
    start: ICAL.Time,
    end: ICAL.Time,
    recurring = false
  ) => {
    const startsAt = start.toJSDate();
    const endsAt = end.toJSDate();
    if (endsAt <= from || startsAt >= to) return;
    out.push({
      externalId: `${uid}:${key}`,
      title: summary || "(no title)",
      location: location || null,
      startsAt,
      endsAt,
      allDay: start.isDate,
      recurring,
    });
  };
  const cancelled = (v: ICAL.Component) =>
    String(v.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";

  for (const master of masters) {
    const event = new ICAL.Event(master);
    for (const exc of exceptions) {
      if (exc.getFirstPropertyValue("uid") === event.uid) event.relateException(exc);
    }

    if (!event.isRecurring()) {
      if (!cancelled(master)) {
        push(event.uid, event.startDate.toString(), event.summary, event.location, event.startDate, event.endDate);
      }
      continue;
    }

    const it = event.iterator();
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      const next = it.next();
      if (!next || next.toJSDate() >= to) break;
      const details = event.getOccurrenceDetails(next);
      if (cancelled(details.item.component)) continue;
      push(
        event.uid,
        details.recurrenceId.toString(),
        details.item.summary,
        details.item.location,
        details.startDate,
        details.endDate,
        true
      );
    }
  }

  // Moved occurrences whose recurring master isn't in the feed.
  for (const exc of exceptions) {
    if (masterUids.has(exc.getFirstPropertyValue("uid")) || cancelled(exc)) continue;
    const event = new ICAL.Event(exc);
    push(event.uid, event.recurrenceId.toString(), event.summary, event.location, event.startDate, event.endDate, true);
  }

  return out;
}

async function syncFeed(feed: CalendarFeed) {
  // webcal:// is just https for subscription links (iCloud, Brightspace).
  const url = feed.url.replace(/^webcal:\/\//i, "https://");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetching the feed failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("This link doesn't return an iCal calendar");

  const { from, to } = syncWindow();
  const events = parseFeed(text, from, to).map((e) => ({ ...e, calendar: feed.name }));
  return replaceEvents(feed.id, events);
}

export function syncWindow() {
  const now = Date.now();
  return {
    from: new Date(now - SYNC_PAST_DAYS * 86_400_000),
    to: new Date(now + SYNC_FUTURE_DAYS * 86_400_000),
  };
}

/** Replaces all stored events of one source (a feed or an iCloud calendar). */
export async function replaceEvents(feedId: string, events: ParsedEvent[]) {
  // Deduplicate: some feeds repeat the same occurrence.
  const unique = [...new Map(events.map((e) => [e.externalId, e])).values()];
  await db.transaction(async (tx) => {
    await tx.delete(calendarEvents).where(eq(calendarEvents.feedId, feedId));
    for (let i = 0; i < unique.length; i += 500) {
      await tx.insert(calendarEvents).values(unique.slice(i, i + 500).map((e) => ({ ...e, feedId })));
    }
  });
  return unique.length;
}

/** Syncs every feed (or just one); errors are stored on the feed, not thrown. */
export async function syncFeeds(onlyId?: string) {
  const feeds = await listFeeds();
  const results: Record<string, number | string> = {};
  for (const feed of feeds) {
    if (onlyId && feed.id !== onlyId) continue;
    try {
      results[feed.id] = await syncFeed(feed);
      feed.lastSyncedAt = new Date().toISOString();
      feed.lastError = null;
    } catch (err) {
      console.error(`Calendar feed "${feed.name}" failed to sync`, err);
      feed.lastError = err instanceof Error ? err.message : String(err);
      results[feed.id] = feed.lastError;
    }
  }
  // Re-read so a feed added or removed during the sync isn't lost.
  const latest = await listFeeds();
  await saveFeeds(latest.map((f) => feeds.find((s) => s.id === f.id) ?? f));
  return results;
}

/** Events overlapping [from, to), oldest first, with their calendar's name. */
export async function listEvents(from: Date, to: Date) {
  const rows = await db
    .select()
    .from(calendarEvents)
    .where(and(gte(calendarEvents.endsAt, from), lt(calendarEvents.startsAt, to)))
    .orderBy(asc(calendarEvents.startsAt));
  return rows.map(toEvent);
}

export async function getEvent(id: string) {
  const [row] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id));
  return row ? toEvent(row) : null;
}

function toEvent(r: typeof calendarEvents.$inferSelect) {
  return {
    id: r.id,
    title: r.title,
    location: r.location,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    allDay: r.allDay,
    feed: r.calendar,
    // Only single iCloud events can be moved or deleted; feeds are read-only.
    editable: Boolean(r.href) && !r.recurring,
    recurring: r.recurring,
  };
}

export type CalendarEvent = Awaited<ReturnType<typeof listEvents>>[number];
