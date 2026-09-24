"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

// Fired after anything changes reminders outside the cards (e.g. an agent proposed one in chat).
export const REMINDERS_CHANGED_EVENT = "reminders-changed";

export type ReminderItem = {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  agentId: string | null;
  agentName: string | null;
  status: "proposed" | "open" | "done";
  proposedBy: string | null;
};

export type CalendarEventItem = {
  id: string;
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  feed: string | null;
};

/** "Today", "Tomorrow", "Fri", "3 Oct" for a date. */
export function dayLabel(date: Date) {
  const diff = differenceInCalendarDays(date, new Date());
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return format(date, "EEE");
  return format(date, "d MMM");
}

/** Label and urgency for a YYYY-MM-DD due date. */
export function dueInfo(dueDate: string) {
  const date = parseISO(dueDate);
  const diff = differenceInCalendarDays(date, new Date());
  return {
    label: diff < 0 ? `${dayLabel(date)} · overdue` : dayLabel(date),
    overdue: diff < 0,
    soon: diff >= 0 && diff <= 2,
  };
}

export function isoDay(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function tomorrowIso() {
  return isoDay(addDays(new Date(), 1));
}

function readCollapsed(id: string) {
  try {
    return localStorage.getItem(`home-card:${id}`) === "collapsed";
  } catch {
    return false;
  }
}

/** Rounded glass card floating over the constellation; the header collapses it. */
export function FloatingCard({
  id,
  icon,
  title,
  meta,
  actions,
  children,
  className,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  // The cards are client-only (see HomeCards), so localStorage is safe here.
  const [collapsed, setCollapsed] = useState(() => readCollapsed(id));

  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(`home-card:${id}`, c ? "open" : "collapsed");
      } catch {}
      return !c;
    });
  }

  return (
    <section
      className={cn(
        "pointer-events-auto flex flex-col min-h-0 rounded-2xl border border-primary/20 bg-card/75 backdrop-blur-md shadow-[0_0_40px_-12px_var(--primary)]",
        className
      )}
    >
      <header className="flex items-center gap-2 pl-3.5 pr-2 py-2">
        <button
          type="button"
          onClick={toggle}
          className="flex-1 min-w-0 flex items-center gap-2 text-left text-sm font-medium"
          aria-expanded={!collapsed}
        >
          <span className="text-primary shrink-0 [&_svg]:size-4">{icon}</span>
          <span className="truncate">{title}</span>
          {meta && <span className="text-xs font-normal text-muted-foreground truncate">{meta}</span>}
          <ChevronDown
            className={cn("size-3.5 ml-auto shrink-0 text-muted-foreground transition-transform", collapsed && "-rotate-90")}
          />
        </button>
        {actions}
      </header>
      {!collapsed && <div className="flex flex-col min-h-0 px-3.5 pb-3">{children}</div>}
    </section>
  );
}
