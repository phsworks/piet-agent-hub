"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Bell, Check, CornerDownLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FloatingCard, dueInfo, tomorrowIso, type ReminderItem } from "./shared";

const selectClass =
  "h-7 min-w-0 rounded-md border border-input bg-input/30 px-1.5 text-xs text-foreground outline-none focus-visible:border-ring";

function ReminderRow({
  reminder,
  onChange,
}: {
  reminder: ReminderItem;
  onChange: (id: string, patch: Partial<ReminderItem> | null) => void;
}) {
  const due = reminder.dueDay ? dueInfo(reminder.dueDay) : null;
  const done = Boolean(reminder.done);

  return (
    <li className="group flex items-start gap-2 py-1">
      <button
        type="button"
        disabled={done}
        onClick={() => onChange(reminder.id, { done: true })}
        className={cn(
          "size-3.5 mt-0.5 shrink-0 rounded-full border border-muted-foreground/60 flex items-center justify-center hover:border-primary",
          done && "bg-primary border-primary"
        )}
        aria-label={done ? "Done" : "Mark as done"}
      >
        {done && <Check className="size-2.5 text-primary-foreground" />}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className={cn("text-xs leading-snug", done && "line-through text-muted-foreground")}
          title={reminder.notes ?? undefined}
        >
          {reminder.title}
        </div>
        {(due || reminder.list !== "Inbox") && (
          <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            {due && (
              <span className={cn(!done && due.soon && "text-amber-300", !done && due.overdue && "text-destructive")}>
                {due.label}
                {reminder.dueTime && ` ${reminder.dueTime}`}
              </span>
            )}
            {reminder.list !== "Inbox" && <span>{reminder.list}</span>}
          </div>
        )}
      </div>
      {!done && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-60"
          onClick={() => onChange(reminder.id, null)}
          title="Delete"
        >
          <Trash2 />
        </Button>
      )}
    </li>
  );
}

/** TickTick tasks: quick add (understands "morgen 9:00 …"), tick off, delete. */
export function RemindersCard({
  reminders,
  connected,
  onReload,
  onLocalChange,
}: {
  reminders: ReminderItem[];
  connected: boolean;
  onReload: () => void;
  onLocalChange: (id: string, patch: Partial<ReminderItem> | null) => void;
}) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const openCount = reminders.filter((r) => !r.done).length;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, dueDate: dueDate || null }),
      });
      if (!res.ok) throw new Error(await res.text());
      setTitle("");
      setDueDate("");
      onReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the task");
    } finally {
      setSaving(false);
    }
  }

  // Optimistic: update the list right away, then sync with TickTick.
  async function change(id: string, patch: Partial<ReminderItem> | null) {
    onLocalChange(id, patch);
    const res = await fetch(`/api/reminders/${encodeURIComponent(id)}`, {
      method: patch ? "PATCH" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: patch ? JSON.stringify({ status: "done" }) : undefined,
    });
    if (!res.ok) {
      toast.error("Couldn't update the task");
      onReload();
    }
  }

  return (
    <FloatingCard id="reminders" icon={<Bell />} title="Tasks" meta={openCount > 0 ? `${openCount} open · TickTick` : "TickTick"}>
      {!connected ? (
        <p className="text-xs text-muted-foreground">
          TickTick isn&apos;t connected.{" "}
          <Link href="/settings" className="underline hover:text-foreground">
            Connect it in Settings
          </Link>
        </p>
      ) : (
        <>
          <form onSubmit={add} className="flex flex-col gap-1.5">
            <div className="relative">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="morgen 9:00 mail docent…"
                className="h-8 pr-7 text-sm"
                aria-label="New task"
              />
              <CornerDownLeft className="size-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
            {/* The date picker only appears once Piet starts typing, to keep the card calm. */}
            {title.trim() && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={cn(selectClass, "flex-1 [color-scheme:dark]")}
                  aria-label="Date (optional; a date in the text works too)"
                />
                {!dueDate && (
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() => setDueDate(tomorrowIso())}
                  >
                    tomorrow
                  </button>
                )}
              </div>
            )}
          </form>

          <ul className="flex flex-col max-h-72 overflow-y-auto mt-2">
            {reminders.map((r) => (
              <ReminderRow key={r.id} reminder={r} onChange={change} />
            ))}
          </ul>
          {reminders.length === 0 && <p className="text-xs text-muted-foreground pt-1">Nothing to do 🎉</p>}
        </>
      )}
    </FloatingCard>
  );
}
