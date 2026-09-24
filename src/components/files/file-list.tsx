"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, ChevronDown, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type FileItem = {
  id: string;
  name: string;
  path: string | null;
  kind: "upload" | "drive" | "code";
  section: string | null;
  agentId: string | null;
  agentName: string | null;
  status: "queued" | "processing" | "ready" | "failed";
  error: string | null;
  summary: string | null;
  size: number | null;
  driveUrl: string | null;
  createdAt: string;
  processedAt: string | null;
};

export function formatDate(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function StatusIcon({ file }: { file: FileItem }) {
  if (file.status === "queued" || file.status === "processing") {
    return <Loader2 className="size-3.5 animate-spin text-muted-foreground shrink-0" aria-label={file.status} />;
  }
  if (file.status === "failed") {
    return <AlertCircle className="size-3.5 text-destructive shrink-0" aria-label="failed" />;
  }
  return null;
}

/** One file with an expandable summary, Drive link, retry and remove. */
export function FileRow({
  file,
  showAgent,
  onChanged,
}: {
  file: FileItem;
  showAgent?: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);

  async function retry() {
    await fetch(`/api/files/${file.id}`, { method: "POST" });
    onChanged();
  }

  async function remove() {
    const res = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
    if (!res.ok) toast.error("Couldn't remove file");
    else toast.success(file.kind === "upload" ? "Removed from the app (still in Drive)" : "Removed from the app");
    onChanged();
  }

  return (
    <li className="group rounded-lg border border-transparent hover:border-border hover:bg-background/40 transition-colors">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <StatusIcon file={file} />
        {file.driveUrl ? (
          <a
            href={file.driveUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 min-w-0 text-sm truncate hover:underline"
            title={`Open ${file.path ?? file.name} in Drive`}
          >
            {file.name}
          </a>
        ) : (
          <span className="flex-1 min-w-0 text-sm truncate" title={file.path ?? file.name}>
            {file.name}
          </span>
        )}
        {file.summary && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={open ? "Hide summary" : "Show summary"}
            title={open ? "Hide summary" : "Show summary"}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          </Button>
        )}
        {showAgent && file.agentName && (
          <Badge variant="outline" className="shrink-0 hidden sm:inline-flex">
            {file.agentName}
          </Badge>
        )}
        <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:inline">
          {formatDate(file.createdAt)}
        </span>
        <div className="flex shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          {file.status === "failed" && (
            <Button variant="ghost" size="icon-xs" aria-label="Retry" onClick={retry}>
              <RotateCcw />
            </Button>
          )}
          <Button variant="ghost" size="icon-xs" aria-label="Remove" onClick={remove}>
            <Trash2 />
          </Button>
        </div>
      </div>
      {(open || file.status === "failed") && (file.summary || file.error) && (
        <p
          className={cn(
            "px-2 pb-2 pl-7 text-xs leading-relaxed whitespace-pre-wrap",
            file.status === "failed" ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {file.status === "failed" ? file.error : file.summary}
        </p>
      )}
    </li>
  );
}

/** Renders the '## ' headings and '- ' bullets the overview prompts ask for. */
export function SimpleText({ text, className }: { text: string; className?: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={blocks.length} className="list-disc pl-5 space-y-1">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
    } else if (/^#{1,3} /.test(line)) {
      flush();
      blocks.push(
        <h3 key={blocks.length} className="font-medium text-foreground pt-2 first:pt-0">
          {line.replace(/^#{1,3} /, "")}
        </h3>
      );
    } else if (/^[-*] /.test(line)) {
      bullets.push(line.slice(2));
    } else {
      flush();
      blocks.push(<p key={blocks.length}>{line}</p>);
    }
  }
  flush();
  return <div className={cn("space-y-2 text-sm leading-relaxed", className)}>{blocks}</div>;
}
