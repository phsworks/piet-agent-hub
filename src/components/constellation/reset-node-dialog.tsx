"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AgentNode } from "./types";

type Parts = { chats: boolean; summary: boolean; files: boolean };

const OPTIONS: { key: keyof Parts; label: string; hint: string }[] = [
  { key: "chats", label: "Chat history", hint: "All conversations started with this node." },
  { key: "summary", label: "Summary", hint: "It's written again from what's left." },
  {
    key: "files",
    label: "Files and linked Drive folders",
    hint: "Removed from the app and search. The files themselves stay in your Google Drive.",
  },
];

/** Clears the chosen parts of a node (not its sub-nodes), so it can start fresh. */
export function ResetNodeDialog({
  agent,
  open,
  onOpenChange,
  onReset,
}: {
  agent: AgentNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReset: (parts: Parts) => void;
}) {
  const [parts, setParts] = useState<Parts>({ chats: true, summary: true, files: false });
  const [resetting, setResetting] = useState(false);

  async function reset() {
    setResetting(true);
    const res = await fetch(`/api/agents/${agent.id}/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parts),
    });
    setResetting(false);
    if (!res.ok) {
      toast.error(await res.text());
      return;
    }
    toast.success(`${agent.name} reset`);
    onOpenChange(false);
    onReset(parts);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset {agent.name}?</DialogTitle>
          <DialogDescription>
            Choose what to clear. Sub-nodes and what the Brain remembers about you are kept.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {OPTIONS.map((o) => (
            <label key={o.key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={parts[o.key]}
                onChange={(e) => setParts((p) => ({ ...p, [o.key]: e.target.checked }))}
                className="mt-1 accent-primary"
              />
              <span>
                {o.label}
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={reset}
            disabled={resetting || !(parts.chats || parts.summary || parts.files)}
          >
            {resetting ? "Resetting…" : "Reset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
