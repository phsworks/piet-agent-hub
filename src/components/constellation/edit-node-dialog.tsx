"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AgentNode } from "./types";

/**
 * Edits a node's name, description and instructions (system prompt), by hand or
 * by describing the change in a prompt. Saving refreshes the node's summary.
 */
export function EditNodeDialog({
  agent,
  open,
  onOpenChange,
  onSaved,
}: {
  agent: AgentNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt);
  const [saving, setSaving] = useState(false);
  const [request, setRequest] = useState("");
  const [proposing, setProposing] = useState(false);
  // Facts about Piet from the prompt, saved as memories along with the edit.
  const [facts, setFacts] = useState<string[]>([]);

  async function propose() {
    setProposing(true);
    const res = await fetch(`/api/agents/${agent.id}/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request }),
    });
    setProposing(false);
    if (!res.ok) {
      toast.error((await res.text()) || "Couldn't rewrite the node");
      return;
    }
    const p = (await res.json()) as { name: string; description: string; systemPrompt: string; facts: string[] };
    setName(p.name);
    setDescription(p.description);
    setSystemPrompt(p.systemPrompt);
    setFacts(p.facts);
    setRequest("");
    toast.success("Rewritten. Check the fields below, then save.");
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, systemPrompt, facts }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(await res.text());
      return;
    }
    const { driveWarning } = (await res.json()) as { driveWarning?: string };
    if (driveWarning) toast.warning(driveWarning);
    else toast.success(`${name.trim()} saved`);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit {agent.name}</DialogTitle>
          <DialogDescription>
            Describe what should change, or edit the fields yourself. A rename also renames its folder
            in Drive. Saving refreshes the summary.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
            <label className="flex flex-col gap-1 text-sm">
              Change with a prompt
              <Textarea
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && request.trim()) {
                    e.preventDefault();
                    propose();
                  }
                }}
                placeholder="e.g. Also cover my job at StudentAanHuis, where I help elderly people with their computers at home"
                className="min-h-16"
                autoFocus
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="self-end"
              onClick={propose}
              disabled={proposing || !request.trim()}
            >
              <Sparkles className={proposing ? "animate-pulse" : undefined} />
              {proposing ? "Rewriting…" : "Rewrite"}
            </Button>
          </div>
          {facts.length > 0 && (
            <div className="flex flex-col gap-1 text-sm">
              Will also be remembered
              <ul className="flex flex-col gap-1">
                {facts.map((fact, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="flex-1">{fact}</span>
                    <button
                      type="button"
                      aria-label="Don't remember this"
                      className="hover:text-foreground"
                      onClick={() => setFacts((f) => f.filter((_, j) => j !== i))}
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Name
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Description
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-16"
            />
            <span className="text-xs text-muted-foreground">Helps the Brain route questions and files here.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Instructions
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="min-h-32 max-h-72 text-xs font-mono"
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || proposing || !name.trim() || !systemPrompt.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
