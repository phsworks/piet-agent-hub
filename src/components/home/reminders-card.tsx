"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bell, Check, CornerDownLeft, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { branchColor, type AgentNode } from "@/components/constellation/types";
import { FloatingCard, dueInfo, tomorrowIso, type ReminderItem } from "./shared";

/** Nodes in tree order, indented by depth, for the "belongs to" picker. */
function nodeOptions(agents: AgentNode[]) {
  const out: { agent: AgentNode; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const a of agents.filter((x) => x.parentId === parentId).sort((x, y) => x.position - y.position)) {
      out.push({ agent: a, depth });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

const selectClass =
  "h-7 min-w-0 rounded-md border border-input bg-input/30 px-1.5 text-xs text-foreground outline-none focus-visible:border-ring";

function ReminderRow({
  reminder,
  agents,
  onChange,
  onSelectAgent,
}: {
  reminder: ReminderItem;
  agents: AgentNode[];
  onChange: (id: string, patch: Partial<ReminderItem> | null) => void;
  onSelectAgent: (agent: AgentNode) => void;
}) {
  const agent = agents.find((a) => a.id === reminder.agentId);
  const due = reminder.dueDate ? dueInfo(reminder.dueDate) : null;
  const done = reminder.status === "done";
  const proposed = reminder.status === "proposed";

  return (
    <li className="group flex items-start gap-2 py-1">
      {proposed ? (
        <Sparkles className="size-3.5 mt-0.5 shrink-0 text-primary" aria-label="Suggested" />
      ) : (
        <button
          type="button"
          onClick={() => onChange(reminder.id, { status: done ? "open" : "done" })}
          className={cn(
            "size-3.5 mt-0.5 shrink-0 rounded-full border border-muted-foreground/60 flex items-center justify-center hover:border-primary",
            done && "bg-primary border-primary"
          )}
          aria-label={done ? "Mark as not done" : "Mark as done"}
        >
          {done && <Check className="size-2.5 text-primary-foreground" />}
        </button>
      )}
      <div className="flex-1 min-w-0">
        <div
          className={cn("text-xs leading-snug", done && "line-through text-muted-foreground")}
          title={reminder.notes ?? undefined}
        >
          {reminder.title}
        </div>
        {(due || agent || proposed) && (
          <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            {due && (
              <span className={cn(!done && due.soon && "text-amber-300", !done && due.overdue && "text-destructive")}>
                {due.label}
              </span>
            )}
            {agent && (
              <button
                type="button"
                onClick={() => onSelectAgent(agent)}
                className="flex items-center gap-1 hover:text-foreground"
              >
                <span className="size-1.5 rounded-full" style={{ background: branchColor(agent.branch) }} />
                {agent.name}
              </button>
            )}
            {proposed && reminder.proposedBy && <span>suggested by {reminder.proposedBy}</span>}
          </div>
        )}
      </div>
      {proposed ? (
        <div className="flex shrink-0">
          <Button variant="ghost" size="icon-xs" onClick={() => onChange(reminder.id, { status: "open" })} title="Accept">
            <Check />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={() => onChange(reminder.id, null)} title="Dismiss">
            <X />
          </Button>
        </div>
      ) : (
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

/** Quick-add reminders, optionally with a due date (→ deadline) and a node. */
export function RemindersCard({
  reminders,
  agents,
  onReload,
  onLocalChange,
  onSelectAgent,
}: {
  reminders: ReminderItem[];
  agents: AgentNode[];
  onReload: () => void;
  onLocalChange: (id: string, patch: Partial<ReminderItem> | null) => void;
  onSelectAgent: (agent: AgentNode) => void;
}) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [agentId, setAgentId] = useState("");
  const [saving, setSaving] = useState(false);

  const proposed = reminders.filter((r) => r.status === "proposed");
  const rest = reminders.filter((r) => r.status !== "proposed");
  const openCount = reminders.filter((r) => r.status === "open").length;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, dueDate: dueDate || null, agentId: agentId || null }),
      });
      if (!res.ok) throw new Error(await res.text());
      setTitle("");
      setDueDate("");
      onReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the reminder");
    } finally {
      setSaving(false);
    }
  }

  // Optimistic: update the list right away, then sync with the server.
  async function change(id: string, patch: Partial<ReminderItem> | null) {
    onLocalChange(id, patch);
    const res = await fetch(`/api/reminders/${id}`, {
      method: patch ? "PATCH" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: patch ? JSON.stringify(patch) : undefined,
    });
    if (!res.ok) toast.error("Couldn't update the reminder");
    onReload();
  }

  return (
    <FloatingCard id="reminders" icon={<Bell />} title="Reminders" meta={openCount > 0 ? `${openCount} open` : undefined}>
      <form onSubmit={add} className="flex flex-col gap-1.5">
        <div className="relative">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Remind me to…"
            className="h-8 pr-7 text-sm"
            aria-label="New reminder"
          />
          <CornerDownLeft className="size-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>
        {/* Date and node only appear once Piet starts typing, to keep the card calm. */}
        {title.trim() && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={cn(selectClass, "flex-1 [color-scheme:dark]")}
              aria-label="Deadline (optional)"
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
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className={cn(selectClass, "flex-1")}
              aria-label="Belongs to node"
            >
              <option value="">No node</option>
              {nodeOptions(agents).map(({ agent, depth }) => (
                <option key={agent.id} value={agent.id}>
                  {"  ".repeat(depth)}
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </form>

      <div className="flex flex-col max-h-72 overflow-y-auto mt-2">
        {proposed.length > 0 && (
          <>
            <h4 className="text-[11px] uppercase tracking-wide text-muted-foreground pt-1">Suggested</h4>
            <ul className="flex flex-col">
              {proposed.map((r) => (
                <ReminderRow key={r.id} reminder={r} agents={agents} onChange={change} onSelectAgent={onSelectAgent} />
              ))}
            </ul>
            {rest.length > 0 && <div className="border-t border-border/60 my-1" />}
          </>
        )}
        <ul className="flex flex-col">
          {rest.map((r) => (
            <ReminderRow key={r.id} reminder={r} agents={agents} onChange={change} onSelectAgent={onSelectAgent} />
          ))}
        </ul>
        {reminders.length === 0 && (
          <p className="text-xs text-muted-foreground pt-1">Nothing to remember yet.</p>
        )}
      </div>
    </FloatingCard>
  );
}
