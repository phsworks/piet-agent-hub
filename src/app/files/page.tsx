"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FolderUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FileRow, type FileItem } from "@/components/files/file-list";
import { DropZone } from "@/components/uploads/drop-zone";
import { filesFromInput, type PickedFile } from "@/components/uploads/drop-files";
import { FILES_CHANGED_EVENT, useUploads } from "@/components/uploads/upload-provider";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Processing" },
  { key: "failed", label: "Failed" },
] as const;

export default function FilesPage() {
  const [files, setFiles] = useState<FileItem[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { uploadFiles } = useUploads();

  const load = useCallback(async () => {
    const res = await fetch("/api/files");
    setFiles(await res.json());
  }, []);

  useEffect(() => {
    let ignore = false;
    const refresh = () =>
      fetch("/api/files")
        .then((res) => res.json())
        .then((data) => {
          if (!ignore) setFiles(data);
        });
    refresh();
    window.addEventListener(FILES_CHANGED_EVENT, refresh);
    return () => {
      ignore = true;
      window.removeEventListener(FILES_CHANGED_EVENT, refresh);
    };
  }, []);

  const toBrain = (picked: PickedFile[]) => uploadFiles(picked, { label: "the Brain" });

  const visible = (files ?? []).filter((f) => {
    if (filter === "active" && f.status !== "queued" && f.status !== "processing") return false;
    if (filter === "failed" && f.status !== "failed") return false;
    const q = query.trim().toLowerCase();
    return !q || f.name.toLowerCase().includes(q) || (f.agentName ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="max-w-3xl w-full mx-auto px-4 py-8 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold">Files</h1>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              toBrain(filesFromInput(e.target.files));
              e.target.value = "";
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            {...{ webkitdirectory: "" }}
            onChange={(e) => {
              toBrain(filesFromInput(e.target.files));
              e.target.value = "";
            }}
          />
          <Button variant="outline" onClick={() => folderInputRef.current?.click()} className="hidden md:inline-flex">
            <FolderUp /> Folder
          </Button>
          <Button onClick={() => fileInputRef.current?.click()}>
            <Upload /> Upload
          </Button>
        </div>
      </div>

      <DropZone
        onFiles={toBrain}
        hint="Drop and the Brain files it"
        className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
      >
        Drop files, folders or zips here (or anywhere). The Brain decides where each one belongs,
        stores it in your Drive under <code>/PietBrain</code> and makes it searchable. To send files
        somewhere specific, open a node in the constellation and drop them there.
      </DropZone>

      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full px-3 py-1 text-xs border transition-colors",
              filter === f.key
                ? "border-primary/60 bg-primary/15 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label}
          </button>
        ))}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or agent"
          className="ml-auto w-full sm:w-56"
        />
      </div>

      {files === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {files !== null && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">No files here yet.</p>
      )}
      <ul className="flex flex-col">
        {visible.map((f) => (
          <FileRow key={f.id} file={f} showAgent onChanged={load} />
        ))}
      </ul>
    </div>
  );
}
