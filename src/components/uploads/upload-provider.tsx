"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { filterCodeEntries, stripCommonRoot } from "@/lib/files/code-filter";
import { filesFromDrop, isFileDrag, type PickedFile } from "./drop-files";

export type UploadTarget = { agentId?: string; section?: string; label: string };

type UploadContextValue = {
  uploadFiles: (files: PickedFile[], target: UploadTarget) => Promise<void>;
  uploadCode: (agentId: string, files: PickedFile[]) => Promise<void>;
  /** Files still queued/processing on the server. */
  pending: number;
};

const UploadContext = createContext<UploadContextValue | null>(null);

export function useUploads() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUploads must be used inside UploadProvider");
  return ctx;
}

/** Fired on window whenever uploaded files change state; pages refetch on it. */
export const FILES_CHANGED_EVENT = "files-changed";

// Keep each request reasonably small; big batches go in several requests.
const MAX_BATCH_FILES = 20;
const MAX_BATCH_BYTES = 40 * 1024 * 1024;
const POLL_MS = 3000;

function batches(files: PickedFile[]) {
  const out: PickedFile[][] = [];
  let current: PickedFile[] = [];
  let bytes = 0;
  for (const f of files) {
    if (current.length > 0 && (current.length >= MAX_BATCH_FILES || bytes + f.file.size > MAX_BATCH_BYTES)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(f);
    bytes += f.file.size;
  }
  if (current.length) out.push(current);
  return out;
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const [uploading, setUploading] = useState(0);
  const [pending, setPending] = useState(0);
  const [dragging, setDragging] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastPending = useRef(0);

  // Polls the server queue until it's empty; restarted after every upload.
  const poll = useCallback(() => {
    const tick = async () => {
      try {
        const res = await fetch("/api/files?status=queued,processing");
        const rows = (await res.json()) as unknown[];
        if (rows.length !== lastPending.current) {
          window.dispatchEvent(new Event(FILES_CHANGED_EVENT));
        }
        lastPending.current = rows.length;
        setPending(rows.length);
        if (rows.length > 0) pollRef.current = setTimeout(tick, POLL_MS);
      } catch {
        pollRef.current = setTimeout(tick, POLL_MS * 3);
      }
    };
    clearTimeout(pollRef.current);
    tick();
  }, []);

  useEffect(() => {
    poll();
    return () => clearTimeout(pollRef.current);
  }, [poll]);

  const uploadFiles = useCallback(
    async (files: PickedFile[], target: UploadTarget) => {
      if (files.length === 0) return;
      setUploading((n) => n + files.length);
      let queued = 0;
      let duplicates = 0;
      try {
        for (const batch of batches(files)) {
          const form = new FormData();
          for (const f of batch) {
            form.append("file", f.file);
            form.append("path", f.path.includes("/") ? f.path : "");
          }
          if (target.agentId) form.append("agentId", target.agentId);
          if (target.section) form.append("section", target.section);
          const res = await fetch("/api/uploads", { method: "POST", body: form });
          if (!res.ok) throw new Error(await res.text());
          const result = (await res.json()) as { queued: number; duplicates: number };
          queued += result.queued;
          duplicates += result.duplicates;
          setUploading((n) => n - batch.length);
        }
        toast.success(
          `${queued} file${queued === 1 ? "" : "s"} sent to ${target.label}` +
            (duplicates ? ` (${duplicates} already there)` : "")
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(0);
        window.dispatchEvent(new Event(FILES_CHANGED_EVENT));
        poll();
      }
    },
    [poll]
  );

  const uploadCode = useCallback(
    async (agentId: string, files: PickedFile[]) => {
      const entries = files.map((f) => ({ ...f, size: f.file.size }));
      const isZip = entries.length === 1 && entries[0].path.toLowerCase().endsWith(".zip");
      let toSend = entries;
      if (!isZip) {
        // Filter before anything leaves the Mac: no node_modules, secrets, binaries.
        const { entries: relative } = stripCommonRoot(entries);
        const gitignoreFile = relative.find((e) => e.path === ".gitignore");
        const gitignore = gitignoreFile ? await gitignoreFile.file.text() : undefined;
        const { kept, truncated } = filterCodeEntries(relative, gitignore);
        const keptFiles = new Set(kept.map((k) => k.file));
        toSend = entries.filter((e) => keptFiles.has(e.file));
        if (truncated) toast.warning("Project is large; only part of it was included.");
      }
      if (toSend.length === 0) {
        toast.error("No code files found in that folder.");
        return;
      }

      setUploading((n) => n + 1);
      try {
        const form = new FormData();
        for (const f of toSend) {
          form.append("file", f.file);
          form.append("path", f.path);
        }
        const res = await fetch(`/api/agents/${agentId}/code`, { method: "POST", body: form });
        if (!res.ok) throw new Error(await res.text());
        const result = (await res.json()) as { files: number; skipped: number };
        toast.success(`Code snapshot queued: ${result.files} files (${result.skipped} skipped)`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Code upload failed");
      } finally {
        setUploading((n) => n - 1);
        window.dispatchEvent(new Event(FILES_CHANGED_EVENT));
        poll();
      }
    },
    [poll]
  );

  // Anything dropped outside a specific drop zone goes to the Brain to sort.
  useEffect(() => {
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!e.dataTransfer || !isFileDrag(e)) return;
      e.preventDefault();
      const files = await filesFromDrop(e.dataTransfer);
      uploadFiles(files, { label: "the Brain" });
    };
    // Drop zones stop propagation, so this only sees drops outside them.
    const onZoneDrop = () => {
      depth = 0;
      setDragging(false);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("zone-drop", onZoneDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("zone-drop", onZoneDrop);
    };
  }, [uploadFiles]);

  const busy = uploading > 0 || pending > 0;

  return (
    <UploadContext.Provider value={{ uploadFiles, uploadCode, pending }}>
      {children}
      {dragging && (
        <div className="pointer-events-none fixed inset-x-0 top-14 z-50 flex justify-center">
          <div className="flex items-center gap-2 rounded-full border border-primary/40 bg-card/90 px-4 py-2 text-sm shadow-lg backdrop-blur">
            <Upload className="size-4 text-primary" />
            Drop anywhere and the Brain files it, or on a node&apos;s panel to send it there
          </div>
        </div>
      )}
      {busy && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-border bg-card/90 px-3.5 py-2 text-xs shadow-lg backdrop-blur">
          <Loader2 className="size-3.5 animate-spin text-primary" />
          {uploading > 0
            ? `Uploading ${uploading} file${uploading === 1 ? "" : "s"}…`
            : `Processing ${pending} file${pending === 1 ? "" : "s"}…`}
        </div>
      )}
    </UploadContext.Provider>
  );
}
