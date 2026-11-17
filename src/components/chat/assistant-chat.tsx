"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { filesFromInput } from "@/components/uploads/drop-files";
import { useUploads } from "@/components/uploads/upload-provider";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Tool currently running, shown while the reply is still empty. */
  tool?: string;
  deep?: boolean;
};

type ChatEvent = { type: "text"; text: string } | { type: "tool"; name: string } | { type: "error"; message: string };

// Keep in sync with TOOL_LABELS in src/lib/assistant/tools.ts.
const TOOL_LABELS: Record<string, string> = {
  search: "Zoeken…",
  drive_search: "Zoeken in Drive…",
  read_document: "Document lezen…",
  list_deadlines: "Agenda bekijken…",
  create_reminder: "Taak maken…",
  complete_task: "Afvinken…",
  create_event: "Inplannen…",
  move_event: "Verplaatsen…",
  delete_event: "Verwijderen…",
  save_note: "Opslaan…",
};


/** Chat with the assistant. Same brain as the Telegram bot, separate conversation. */
export function AssistantChat() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFiles } = useUploads();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const updateLast = (fn: (last: ChatMessage) => ChatMessage) =>
    setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: message, deep }, { role: "assistant", content: "" }]);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message, deep }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());
      setConversationId(res.headers.get("X-Conversation-Id"));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "tool") {
            updateLast((last) => ({ ...last, tool: event.name }));
          } else if (event.type === "text") {
            updateLast((last) => ({ ...last, tool: undefined, content: event.text }));
          } else {
            updateLast((last) => ({ ...last, tool: undefined, content: `[${event.message}]` }));
          }
        }
      }
    } catch (err) {
      console.error(err);
      updateLast((last) => ({ ...last, tool: undefined, content: last.content || "[Er ging iets mis. Draait de app?]" }));
    } finally {
      setBusy(false);
      setDeep(false);
    }
  }

  return (
    <section className="flex flex-col min-h-[420px] md:min-h-0 rounded-2xl border border-primary/20 bg-card/75">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-border text-sm font-medium">
        Vraag het je assistent
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto text-muted-foreground"
            onClick={() => {
              setMessages([]);
              setConversationId(null);
            }}
          >
            Nieuw gesprek
          </Button>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4">
        <div className="flex flex-col gap-3 py-4">
          {messages.length === 0 && (
            <p className="text-muted-foreground text-sm text-center mt-10">
              &ldquo;Waar staat de rubric?&rdquo;, &ldquo;onthoud dat…&rdquo;, &ldquo;wat moet ik deze week doen?&rdquo;
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2 whitespace-pre-wrap break-words text-sm leading-relaxed",
                m.role === "user"
                  ? "self-end bg-primary text-primary-foreground"
                  : "self-start bg-background/60 border border-border"
              )}
            >
              {m.deep && <Sparkles className="inline size-3 mr-1 -mt-0.5" aria-label="Deep" />}
              {m.content || (
                <span className="text-muted-foreground">{(m.tool && TOOL_LABELS[m.tool]) ?? "…"}</span>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-border p-3 flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            uploadFiles(filesFromInput(e.target.files), { label: "your files" });
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="self-end"
          aria-label="Upload files"
          title="Upload files"
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
              send();
            }
          }}
          placeholder="Bericht…"
          className="min-h-[44px] max-h-40 resize-none"
        />
        <Button
          variant={deep ? "default" : "ghost"}
          size="icon"
          className="self-end"
          aria-pressed={deep}
          aria-label="Deep: use the stronger model for this message"
          title="Diep: zwaarder model voor dit bericht"
          onClick={() => setDeep((d) => !d)}
        >
          <Sparkles />
        </Button>
        <Button className="self-end" onClick={send} disabled={busy || !input.trim()}>
          Send
        </Button>
      </div>
    </section>
  );
}
