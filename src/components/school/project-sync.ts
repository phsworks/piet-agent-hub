"use client";

import { zipSync } from "fflate";

// Sends Piet's local Kova folder from the browser (the VPS can't see his Mac).
// Chrome/Edge remember the folder (File System Access API, handle kept in
// IndexedDB); other browsers fall back to picking the folder each time.

const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|prisma|sql|md|ya?ml|json|css|html)$/i;
const SKIP = /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|\.turbo|\.vercel)(\/|$)|(^|\/)\.env|lock\.json$|\.lock$|tsbuildinfo|(^|\/)[^/]*(secret|credential|service-account|private-key)[^/]*$/i;
const MAX_FILE_BYTES = 200_000;

type DirHandle = {
  name: string;
  values(): AsyncIterable<{ kind: "file" | "directory"; name: string; getFile?: () => Promise<File> } & DirHandle>;
  queryPermission(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission(o: { mode: "read" }): Promise<PermissionState>;
};
type PickerWindow = Window & { showDirectoryPicker?: (o?: { id?: string; mode?: "read" }) => Promise<DirHandle> };

export const keepable = (path: string, size: number) => TEXT.test(path) && !SKIP.test(path) && size <= MAX_FILE_BYTES;

function idb<T>(fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open("piet-hva", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("handles");
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        const req = fn(open.result.transaction("handles", "readwrite").objectStore("handles"));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      };
    } catch {
      resolve(undefined);
    }
  });
}

async function walk(dir: DirHandle, prefix: string, out: Record<string, Uint8Array>) {
  for await (const entry of dir.values()) {
    const path = `${prefix}${entry.name}`;
    if (entry.kind === "directory") {
      if (!SKIP.test(`${path}/`)) await walk(entry, `${path}/`, out);
    } else if (TEXT.test(path) && !SKIP.test(path)) {
      const file = await entry.getFile!();
      if (file.size <= MAX_FILE_BYTES) out[path] = new Uint8Array(await file.arrayBuffer());
    }
  }
}

async function upload(files: Record<string, Uint8Array>, name: string) {
  const count = Object.keys(files).length;
  if (count === 0) throw new Error("Geen projectbestanden gevonden in deze map");
  const res = await fetch("/api/school/local-project", {
    method: "POST",
    headers: { "content-type": "application/zip", "x-branch": name, "x-commit": "via de browser", "x-changed": "0" },
    body: zipSync(files, { level: 6 }) as BodyInit,
  });
  if (!res.ok) throw new Error(await res.text());
  return count;
}

export const canRemember = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

/** Re-sends the remembered folder when permission is still there; null when there is none (no prompt). */
export async function syncRemembered(): Promise<number | null> {
  const handle = await idb<DirHandle>((s) => s.get("kova"));
  if (!handle || (await handle.queryPermission({ mode: "read" })) !== "granted") return null;
  const files: Record<string, Uint8Array> = {};
  await walk(handle, "", files);
  return upload(files, handle.name);
}

/** Button click: use the remembered folder (asking permission again if needed) or let Piet pick it. */
export async function syncProject(): Promise<number> {
  const w = window as PickerWindow;
  if (w.showDirectoryPicker) {
    let handle = await idb<DirHandle>((s) => s.get("kova"));
    if (!handle || (await handle.requestPermission({ mode: "read" })) !== "granted") {
      handle = await w.showDirectoryPicker({ id: "kova", mode: "read" });
      await idb((s) => s.put(handle, "kova"));
    }
    const files: Record<string, Uint8Array> = {};
    await walk(handle, "", files);
    return upload(files, handle.name);
  }
  // Safari/Firefox: a folder input, picked each time.
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("webkitdirectory", "");
    input.onchange = async () => {
      try {
        const files: Record<string, Uint8Array> = {};
        for (const f of Array.from(input.files ?? [])) {
          const path = f.webkitRelativePath.split("/").slice(1).join("/");
          if (keepable(path, f.size)) files[path] = new Uint8Array(await f.arrayBuffer());
        }
        resolve(await upload(files, input.files?.[0]?.webkitRelativePath.split("/")[0] ?? "kova"));
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}
