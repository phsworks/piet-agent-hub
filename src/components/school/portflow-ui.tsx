"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { AlertTriangle, Clock, FileText, ImageUp, Link2, Loader2, MessageSquareText, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Mirror, MirrorEvidence } from "@/lib/school/mirror";

// Shared pieces of the Portflow look-alike pages.

export const TYPE = {
  link: { icon: Link2, circle: "bg-yellow-100 text-yellow-600", label: "Losse link" },
  file: { icon: FileText, circle: "bg-green-50 text-green-600", label: "Document (upload)" },
  feedback: { icon: MessageSquareText, circle: "bg-pink-100 text-pink-600", label: "Feedback" },
} as const;
export const typeOf = (t: string) => TYPE[t as keyof typeof TYPE] ?? TYPE.file;

export const relative = (day: string) => {
  const days = Math.round((Date.now() - new Date(`${day.slice(0, 10)}T12:00:00`).getTime()) / 86_400_000);
  if (days <= 0) return "vandaag";
  if (days === 1) return "gisteren";
  if (days < 30) return `${days} dagen geleden`;
  const months = Math.round(days / 30);
  return months === 1 ? "een maand geleden" : `${months} maanden geleden`;
};

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-700">
      <Target className="size-3" /> {children}
    </span>
  );
}

/** The blue name opens the evidence page in a new tab, like Portflow. */
export function EvidenceLine({ e, href, small }: { e: MirrorEvidence; href?: string; small?: boolean }) {
  const name = <span className={`text-blue-600 font-medium leading-snug break-words ${small ? "text-sm" : ""}`}>{e.name}</span>;
  return (
    <div className={small ? "flex flex-wrap items-center gap-x-2 gap-y-0.5" : "flex flex-col gap-1"}>
      {href ? (
        <Link href={href} target="_blank" className="hover:underline">
          {name}
        </Link>
      ) : (
        name
      )}
      <span className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        {!small && (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" /> {relative(e.createdOn)}
          </span>
        )}
        {e.subgoals.map((s) => (
          <Chip key={s}>{s}</Chip>
        ))}
      </span>
      {e.fix && (
        <span className="inline-flex items-start gap-1 text-xs text-amber-700">
          <AlertTriangle className="size-3.5 mt-px shrink-0" /> {e.fix}
        </span>
      )}
    </div>
  );
}

/** The Portflow mirror, refetched on focus and after a screenshot upload. */
export function useMirror() {
  const [data, setData] = useState<Mirror | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/school");
    if (!res.ok) return setError(true);
    setData(await res.json());
    setError(false);
  }, []);

  useEffect(() => {
    let ignore = false;
    const refresh = () =>
      fetch("/api/school")
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((d) => !ignore && setData(d))
        .catch(() => !ignore && setError(true));
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      ignore = true;
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return { data, error, load };
}

export function UploadButton({ onDone }: { onDone: () => void }) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    const form = new FormData();
    for (const f of files) form.append("files", f);
    try {
      const res = await fetch("/api/school/portflow", { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const r = (await res.json()) as { read: number; added: number };
      toast.success(`${r.read} bewijzen gelezen, ${r.added} nieuw`);
      onDone();
    } catch (err) {
      toast.error(`Screenshot inlezen mislukt: ${err instanceof Error ? err.message : err}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
      <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
        {uploading ? <Loader2 className="animate-spin" /> : <ImageUp />}
        {uploading ? "Screenshots lezen…" : "Portflow-screenshots toevoegen"}
      </Button>
    </>
  );
}

export const Loading = ({ error }: { error: boolean }) => (
  <p className="p-6 text-sm text-muted-foreground">{error ? "Laden mislukt. Draait de database?" : "Laden…"}</p>
);

/** Copies a ready-made prompt to make this item (paste it into Claude). */
export function PromptButton({ prompt, iconOnly }: { prompt: () => string; iconOnly?: boolean }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt());
      toast.success("Prompt gekopieerd: plak hem in Claude");
    } catch {
      toast.error("Kopiëren lukte niet");
    }
  }
  return (
    <button type="button" onClick={copy} title="Kopieer een prompt om dit te maken" aria-label="Prompt kopiëren" className={`shrink-0 inline-flex items-center gap-1 rounded-md text-xs text-violet-700 hover:bg-violet-50 ${iconOnly ? "p-1" : "px-2 py-1"}`}>
      <Sparkles className="size-3.5" /> {!iconOnly && "Prompt"}
    </button>
  );
}
