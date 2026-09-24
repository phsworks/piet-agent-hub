"use client";

import { useState } from "react";
import { toast } from "sonner";
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

/** Adds a child node (with its own chat, files and summary) under `parent`. */
export function AddNodeDialog({
  parent,
  onClose,
  onCreated,
}: {
  parent: AgentNode | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isProject, setIsProject] = useState(false);
  const [saving, setSaving] = useState(false);

  function reset() {
    setName("");
    setDescription("");
    setIsProject(false);
  }

  async function create() {
    if (!parent || !name.trim()) return;
    setSaving(true);
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, isProject, parentId: parent.id }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(await res.text());
      return;
    }
    const { id } = (await res.json()) as { id: string };
    toast.success(`${name.trim()} added under ${parent.name}`);
    reset();
    onCreated(id);
  }

  return (
    <Dialog
      open={parent !== null}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New node under {parent?.name}</DialogTitle>
          <DialogDescription>
            For example a semester, a project or a topic. It gets its own chat, a place for files
            and a summary of what&apos;s in them.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name, e.g. Semester 4"
            autoFocus
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is it about? (optional, helps the Brain route questions and files here)"
            className="min-h-20"
          />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={isProject}
              onChange={(e) => setIsProject(e.target.checked)}
              className="mt-1 accent-primary"
            />
            <span>
              This is a project
              <span className="block text-xs text-muted-foreground">
                Files are sorted into sections (brief, deliverables, feedback, notes) and you can add a
                code folder.
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
