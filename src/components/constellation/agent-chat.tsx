"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { AgentNode } from "./types";
import { filesFromInput, type PickedFile } from "@/components/uploads/drop-files";
import { useUploads } from "@/components/uploads/upload-provider";
import { REMINDERS_CHANGED_EVENT } from "@/components/home/shared";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Set when a different agent than the panel's answered (delegation). */
  via?: string;
  /** Tool currently running, shown while the reply is still empty. */
  tool?: string;
};

export type ChatState = {
  conversationId: string | null;
  messages: ChatMessage[];
};

export const EMPTY_CHAT: ChatState = { conversationId: null, messages: [] };

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "agent"; slug: string; name: string }
  | { type: "error"; message: string };

const TOOL_LABELS: Record<string, string> = {
  memory_search: "Searching memory…",
  memory_save: "Saving to memory…",
  files_search: "Searching files…",
  drive_search: "Searching Drive…",
  drive_read: "Reading from Drive…",
  drive_upload: "Saving to Drive…",
  reminder_propose: "Suggesting a reminder…",
  reminder_list: "Checking reminders…",
  calendar_list_events: "Checking the calendar…",
};

/** Messages and input for one agent; lives in the node panel's Chat tab. */
export function AgentChat({
  agent,
  chat,
  onChatChange,
  onActiveSlugChange,
}: {
  agent: AgentNode;
  chat: ChatState;
  onChatChange: (agentId: string, update: (prev: ChatState) => ChatState) => void;
  onActiveSlugChange: (slug: string | null) => void;
}) {
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFiles } = useUploads();

  const sendFiles = (files: PickedFile[]) =>
    uploadFiles(files, { agentId: agent.id, label: agent.name });

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages]);

  async function handleSend() {
    const message = input.trim();
    if (!message || isStreaming) return;

    // Capture the agent this send belongs to; the panel may switch mid-stream.
    const agentId = agent.id;
    const update = (fn: (prev: ChatState) => ChatState) => onChatChange(agentId, fn);
    const updateLast = (fn: (last: ChatMessage) => ChatMessage) =>
      update((prev) => {
        const messages = [...prev.messages];
        messages[messages.length - 1] = fn(messages[messages.length - 1]);
        return { ...prev, messages };
      });

    setInput("");
    update((prev) => ({
      ...prev,
      messages: [
        ...prev.messages,
        { role: "user", content: message },
        { role: "assistant", content: "" },
      ],
    }));
    setIsStreaming(true);
    onActiveSlugChange(agent.slug);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: chat.conversationId,
          agentId,
          message,
        }),
      });

      if (!res.ok || !res.body) throw new Error(await res.text());

      const newConversationId = res.headers.get("X-Conversation-Id");
      if (newConversationId) {
        update((prev) => ({ ...prev, conversationId: newConversationId }));
      }

      const reader = res.body.getReader();
      let proposedReminder = false;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamEvent;
          if (event.type === "text") {
            updateLast((last) => ({
              ...last,
              tool: undefined,
              content: last.content + event.text,
            }));
          } else if (event.type === "tool") {
            if (event.name === "reminder_propose") proposedReminder = true;
            updateLast((last) => ({ ...last, tool: event.name }));
          } else if (event.type === "agent") {
            onActiveSlugChange(event.slug);
            updateLast((last) => ({ ...last, via: event.name }));
          } else if (event.type === "error") {
            updateLast((last) => ({
              ...last,
              content: `${last.content}\n\n[${event.message}]`,
            }));
          }
        }
      }
      // The tool has run by the time the stream ends; let the Reminders card refetch.
      if (proposedReminder) window.dispatchEvent(new Event(REMINDERS_CHANGED_EVENT));
    } catch (err) {
      console.error(err);
      updateLast((last) => ({
        ...last,
        tool: undefined,
        content:
          last.content ||
          "[Something went wrong. Is the app running, the DB seeded, and ANTHROPIC_API_KEY set?]",
      }));
    } finally {
      setIsStreaming(false);
      onActiveSlugChange(null);
    }
  }

  return (
    <>
      <ScrollArea className="flex-1 min-h-0 px-4">
        <div className="flex flex-col gap-3 py-4">
          {chat.messages.length === 0 && (
            <p className="text-muted-foreground text-sm text-center mt-16">
              Say something to {agent.name}.
            </p>
          )}
          {chat.messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "flex flex-col gap-1 max-w-[85%]",
                m.role === "user" ? "self-end items-end" : "self-start"
              )}
            >
              {m.via && (
                <span className="text-[11px] text-muted-foreground px-1">
                  via {m.via}
                </span>
              )}
              <div
                className={cn(
                  "rounded-2xl px-3.5 py-2 whitespace-pre-wrap text-sm leading-relaxed",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background/60 border border-border"
                )}
              >
                {m.content ||
                  (m.role === "assistant" ? (
                    <span className="text-muted-foreground">
                      {(m.tool && (TOOL_LABELS[m.tool] ?? `Using ${m.tool}…`)) || "…"}
                    </span>
                  ) : (
                    ""
                  ))}
              </div>
            </div>
          ))}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      <div className="border-t border-border p-3 flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            sendFiles(filesFromInput(e.target.files));
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="self-end"
          aria-label={`Upload files to ${agent.name}`}
          title={`Upload files to ${agent.name}`}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip />
        </Button>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={`Message ${agent.name}...`}
          className="min-h-[44px] max-h-40 resize-none"
        />
        <Button onClick={handleSend} disabled={isStreaming || !input.trim()}>
          Send
        </Button>
      </div>
    </>
  );
}
