"use client";

import { useCallback, useEffect, useState } from "react";
import { AgendaCard } from "./agenda-card";
import { RemindersCard } from "./reminders-card";
import { REMINDERS_CHANGED_EVENT, type CalendarEventItem, type ReminderItem } from "./shared";

const CALENDAR_REFRESH_MS = 10 * 60_000;

/** Agenda and reminders, next to the chat on the home page. */
export default function HomeCards() {
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [tickTickConnected, setTickTickConnected] = useState(true);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);

  const loadReminders = useCallback(async () => {
    const res = await fetch("/api/reminders");
    if (!res.ok) return;
    const data = (await res.json()) as { connected: boolean; tasks: ReminderItem[] };
    setTickTickConnected(data.connected);
    // Keep ticked-off tasks visible until the next reload, so they don't vanish mid-click.
    setReminders((prev) => [...data.tasks, ...prev.filter((r) => r.done && !data.tasks.some((t) => t.id === r.id))]);
  }, []);

  const loadEvents = useCallback(async () => {
    const res = await fetch("/api/calendar?days=7");
    if (res.ok) setEvents(await res.json());
    setEventsLoaded(true);
  }, []);

  useEffect(() => {
    const reload = () => {
      loadReminders();
      loadEvents();
    };
    reload();
    const timer = setInterval(loadEvents, CALENDAR_REFRESH_MS);
    window.addEventListener(REMINDERS_CHANGED_EVENT, reload);
    window.addEventListener("focus", reload);
    return () => {
      clearInterval(timer);
      window.removeEventListener(REMINDERS_CHANGED_EVENT, reload);
      window.removeEventListener("focus", reload);
    };
  }, [loadReminders, loadEvents]);

  const localChange = useCallback((id: string, patch: Partial<ReminderItem> | null) => {
    setReminders((prev) =>
      patch ? prev.map((r) => (r.id === id ? { ...r, ...patch } : r)) : prev.filter((r) => r.id !== id)
    );
  }, []);

  const deadlines = reminders.filter((r) => !r.done && r.dueDay);

  return (
    <div className="flex flex-col gap-3">
      <AgendaCard events={events} eventsLoaded={eventsLoaded} deadlines={deadlines} />
      <RemindersCard
        reminders={reminders}
        connected={tickTickConnected}
        onReload={loadReminders}
        onLocalChange={localChange}
      />
    </div>
  );
}
