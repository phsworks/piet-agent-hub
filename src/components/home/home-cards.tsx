"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentNode } from "@/components/constellation/types";
import { BriefingCard } from "./briefing-card";
import { AgendaCard } from "./agenda-card";
import { RemindersCard } from "./reminders-card";
import { REMINDERS_CHANGED_EVENT, type CalendarEventItem, type ReminderItem } from "./shared";

const CALENDAR_REFRESH_MS = 10 * 60_000;

/**
 * Today / Agenda / Reminders, floating on the left of the constellation.
 * When the area is narrow (phone, or node panel open on a laptop) they sit
 * behind a button so the graph stays usable.
 */
export default function HomeCards({
  agents,
  onSelectAgent,
}: {
  agents: AgentNode[];
  onSelectAgent: (agent: AgentNode) => void;
}) {
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const loadReminders = useCallback(async () => {
    const res = await fetch("/api/reminders");
    if (res.ok) setReminders(await res.json());
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
    window.addEventListener(REMINDERS_CHANGED_EVENT, loadReminders);
    window.addEventListener("focus", reload);
    return () => {
      clearInterval(timer);
      window.removeEventListener(REMINDERS_CHANGED_EVENT, loadReminders);
      window.removeEventListener("focus", reload);
    };
  }, [loadReminders, loadEvents]);

  const localChange = useCallback((id: string, patch: Partial<ReminderItem> | null) => {
    setReminders((prev) =>
      patch ? prev.map((r) => (r.id === id ? { ...r, ...patch } : r)) : prev.filter((r) => r.id !== id)
    );
  }, []);

  const selectAgent = useCallback(
    (agent: AgentNode) => {
      setMobileOpen(false);
      onSelectAgent(agent);
    },
    [onSelectAgent]
  );

  const deadlines = reminders.filter((r) => r.status === "open" && r.dueDate);

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen((o) => !o)}
        className="@min-[720px]:hidden absolute left-3 top-3 z-[5] flex items-center gap-1.5 rounded-full border border-primary/30 bg-card/80 backdrop-blur-md px-3 py-1.5 text-xs shadow-[0_0_24px_-8px_var(--primary)]"
      >
        {mobileOpen ? <X className="size-3.5" /> : <CalendarDays className="size-3.5 text-primary" />}
        {mobileOpen ? "Close" : "Today"}
        {!mobileOpen && deadlines.length > 0 && (
          <span className="rounded-full bg-primary/25 px-1.5 text-[10px]">{deadlines.length}</span>
        )}
      </button>

      <div
        className={cn(
          // pointer-events-none on the column so the gaps don't block dragging the graph.
          "absolute z-[4] flex flex-col gap-3 overflow-y-auto pointer-events-none",
          // Own column when the area is wide enough (page.tsx shifts the graph right to match)...
          "@min-[720px]:left-4 @min-[720px]:top-4 @min-[720px]:bottom-4 @min-[720px]:w-[340px] @min-[720px]:flex",
          // ...otherwise an overlay behind the Today button.
          "@max-[720px]:inset-x-3 @max-[720px]:top-14 @max-[720px]:bottom-3 @max-[720px]:max-w-md",
          !mobileOpen && "@max-[720px]:hidden"
        )}
      >
        <BriefingCard />
        <AgendaCard
          events={events}
          eventsLoaded={eventsLoaded}
          deadlines={deadlines}
          agents={agents}
          onSelectAgent={selectAgent}
        />
        <RemindersCard
          reminders={reminders}
          agents={agents}
          onReload={loadReminders}
          onLocalChange={localChange}
          onSelectAgent={selectAgent}
        />
      </div>
    </>
  );
}
