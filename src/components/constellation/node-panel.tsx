"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FolderSymlink, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { DropZone } from "@/components/uploads/drop-zone";
import { FILES_CHANGED_EVENT, useUploads } from "@/components/uploads/upload-provider";
import { AgentChat, EMPTY_CHAT, type ChatState } from "./agent-chat";
import { EditNodeDialog } from "./edit-node-dialog";
import { ResetNodeDialog } from "./reset-node-dialog";
import { NodeOverview } from "./node-overview";
import { AgentIcon, branchColor, type AgentNode } from "./types";

export type PanelTab = "overview" | "chat";

/** Side panel for the selected node: an Overview tab (summary + files) and a Chat tab. */
export function NodePanel({
  agent,
  subNodes,
  tab,
  onTabChange,
  chat,
  onChatChange,
  onActiveSlugChange,
  onSelect,
  onAddChild,
  onDeleted,
  onChanged,
  onClose,
}: {
  agent: AgentNode;
  subNodes: AgentNode[];
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  chat: ChatState;
  onChatChange: (agentId: string, update: (prev: ChatState) => ChatState) => void;
  onActiveSlugChange: (slug: string | null) => void;
  onSelect: (agent: AgentNode) => void;
  onAddChild: (parent: AgentNode) => void;
  onDeleted: (agent: AgentNode) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linking, setLinking] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  // Bumped after a reset so the overview reloads (and rewrites its summary).
  const [overviewKey, setOverviewKey] = useState(0);
  const [updatingSummary, setUpdatingSummary] = useState(false);
  const { uploadFiles } = useUploads();
  const color = branchColor(agent.branch);
  const isBrain = agent.parentId === null;

  async function linkFolder() {
    setLinking(true);
    const res = await fetch("/api/drive-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agent.id, url: linkUrl }),
    });
    setLinking(false);
    if (!res.ok) {
      toast.error(await res.text());
      return;
    }
    const result = (await res.json()) as { added: number };
    toast.success(`Linked. Indexing ${result.added} file${result.added === 1 ? "" : "s"}…`);
    setLinkOpen(false);
    setLinkUrl("");
    window.dispatchEvent(new Event(FILES_CHANGED_EVENT));
  }

  // After an edit, rewrite the summary so it reflects the node's new description.
  async function refreshSummary() {
    setUpdatingSummary(true);
    const res = await fetch(`/api/agents/${agent.id}/overview`, { method: "POST" });
    setUpdatingSummary(false);
    if (!res.ok) toast.error("Couldn't update the summary");
    setOverviewKey((k) => k + 1);
  }

  async function remove() {
    const res = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
    setDeleteOpen(false);
    if (!res.ok) {
      toast.error(await res.text());
      return;
    }
    toast.success(`${agent.name} removed (its files stay in Drive)`);
    onDeleted(agent);
  }

  return (
    <DropZone
      onFiles={(files) => uploadFiles(files, { agentId: agent.id, label: agent.name })}
      hint={`Drop to give these files to ${agent.name}`}
      className="flex flex-col h-full min-h-0 bg-card/80 backdrop-blur-md border-l border-border"
    >
      <div className="flex items-start gap-3 px-4 pt-3 pb-2">
        <div className="mt-0.5 rounded-full p-2 shrink-0" style={{ backgroundColor: color + "22", color }}>
          <AgentIcon name={agent.icon} className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-medium text-sm">{agent.name}</h2>
          <p className="text-xs text-muted-foreground line-clamp-2">{agent.description}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Add a node under this one"
          title="Add a node under this one"
          onClick={() => onAddChild(agent)}
        >
          <Plus />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More" />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil /> Edit node
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLinkOpen(true)}>
              <FolderSymlink /> Link Drive folder
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setResetOpen(true)}>
              <RotateCcw /> Reset node
            </DropdownMenuItem>
            {!isBrain && (
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 /> Remove node
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>

      <div className="flex gap-1 px-4 border-b border-border" role="tablist">
        {(["overview", "chat"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => onTabChange(t)}
            className={cn(
              "px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "overview" ? "Overview" : "Chat"}
            {t === "chat" && chat.messages.length > 0 && (
              <span className="ml-1.5 text-[11px] text-muted-foreground">{Math.ceil(chat.messages.length / 2)}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <NodeOverview
          key={overviewKey}
          agent={agent}
          subNodes={subNodes}
          onSelect={onSelect}
          onAddChild={() => onAddChild(agent)}
          updatingSummary={updatingSummary}
        />
      ) : (
        <AgentChat
          agent={agent}
          chat={chat}
          onChatChange={onChatChange}
          onActiveSlugChange={onActiveSlugChange}
        />
      )}

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link a Drive folder to {agent.name}</DialogTitle>
            <DialogDescription>
              For material that&apos;s already in your Drive. Files stay where they are; the app reads
              them and keeps them searchable. Sync again after adding files.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={linkFolder} disabled={linking || !linkUrl.trim()}>
              {linking ? "Linking…" : "Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditNodeDialog
        key={editOpen ? "edit-open" : "edit-closed"}
        agent={agent}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => {
          onChanged();
          refreshSummary();
        }}
      />

      <ResetNodeDialog
        agent={agent}
        open={resetOpen}
        onOpenChange={setResetOpen}
        onReset={(parts) => {
          if (parts.chats) onChatChange(agent.id, () => EMPTY_CHAT);
          if (parts.files) window.dispatchEvent(new Event(FILES_CHANGED_EVENT));
          setOverviewKey((k) => k + 1);
        }}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {agent.name}?</DialogTitle>
            <DialogDescription>
              This removes the node{subNodes.length > 0 ? `, its ${subNodes.length} sub-node(s)` : ""} and
              their files from the app. The files themselves stay in your Google Drive.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DropZone>
  );
}
