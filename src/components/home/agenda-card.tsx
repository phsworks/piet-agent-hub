"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { FloatingCard, dayLabel, dueInfo, type CalendarEventItem, type ReminderItem } from "./shared";

function groupByDay(events: CalendarEventItem[]) {
  const groups = new Map<string, CalendarEventItem[]>();
  for (const e of events) {
    const key = format(new Date(e.startsAt), "yyyy-MM-dd");
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()];
}

function eventTime(e: CalendarEventItem) {
  if (e.allDay) return "All day";
  return `${format(new Date(e.startsAt), "HH:mm")}–${format(new Date(e.endsAt), "HH:mm")}`;
}

/** Upcoming schedule, with the deadlines (dated reminders) next to it. */
export function AgendaCard({
  events,
  eventsLoaded,
  deadlines,
}: {
  events: CalendarEventItem[];
  eventsLoaded: boolean;
  deadlines: ReminderItem[];
}) {
  const days = groupByDay(events);
  const overdue = deadlines.filter((d) => d.dueDay && dueInfo(d.dueDay).overdue).length;

  return (
    <FloatingCard
      id="agenda"
      icon={<CalendarDays />}
      title="Agenda"
      meta={overdue > 0 ? <span className="text-destructive">{overdue} overdue</span> : "next 7 days"}
    >
      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-3 min-h-0">
        <div className="flex flex-col gap-2.5 max-h-72 overflow-y-auto pr-1">
          {eventsLoaded && days.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nothing scheduled.{" "}
              <Link href="/settings" className="underline hover:text-foreground">
                Add your schedule
              </Link>
            </p>
          )}
          {days.map(([day, items]) => (
            <div key={day} className="flex flex-col gap-1">
              <h4 className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {dayLabel(parseISO(day))}
              </h4>
              {items.map((e) => (
                <div
                  key={e.id}
                  className="rounded-lg border-l-2 border-primary/60 bg-primary/5 pl-2 pr-1.5 py-1"
                  title={[e.title, e.location, e.feed].filter(Boolean).join(" · ")}
                >
                  <div className="text-xs font-medium leading-snug line-clamp-2">{e.title}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {eventTime(e)}
                    {e.feed && ` · ${e.feed}`}
                    {e.location && ` · ${e.location}`}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1 min-h-0 border-l border-border/60 pl-3">
          <h4 className="text-[11px] uppercase tracking-wide text-muted-foreground">Deadlines</h4>
          <ul className="flex flex-col gap-1.5 max-h-[16.5rem] overflow-y-auto">
            {deadlines.length === 0 && <li className="text-xs text-muted-foreground">No deadlines 🎉</li>}
            {deadlines.map((d) => {
              const due = dueInfo(d.dueDay!);
              return (
                <li key={d.id} className="flex flex-col">
                  <span className="text-xs leading-snug line-clamp-2" title={d.notes ?? d.title}>
                    {d.title}
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <span
                      className={cn(
                        "text-muted-foreground",
                        due.soon && "text-amber-300",
                        due.overdue && "text-destructive"
                      )}
                    >
                      {due.label}
                      {d.dueTime && ` ${d.dueTime}`}
                    </span>
                    {d.list !== "Inbox" && <span className="truncate text-muted-foreground">{d.list}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </FloatingCard>
  );
}
