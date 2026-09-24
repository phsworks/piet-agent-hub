"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { filesFromDrop, isFileDrag, type PickedFile } from "./drop-files";

/**
 * Catches file drops for a specific target (an agent's chat, a project section)
 * so they don't fall through to the global "Brain sorts it" drop.
 */
export function DropZone({
  onFiles,
  children,
  className,
  activeClassName = "ring-2 ring-primary/60 ring-inset",
  hint,
}: {
  onFiles: (files: PickedFile[]) => void;
  children: ReactNode;
  className?: string;
  activeClassName?: string;
  hint?: string;
}) {
  const [over, setOver] = useState(false);

  return (
    <div
      className={cn("relative", className, over && activeClassName)}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={async (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        window.dispatchEvent(new Event("zone-drop"));
        onFiles(await filesFromDrop(e.dataTransfer));
      }}
    >
      {children}
      {over && hint && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/70 text-sm font-medium text-primary backdrop-blur-sm">
          {hint}
        </div>
      )}
    </div>
  );
}
