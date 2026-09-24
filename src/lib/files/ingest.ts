import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { extensionOf } from "./file-types";
import { kickWorker } from "./worker";

export const TEMP_DIR = path.join(os.tmpdir(), "piet-brain-uploads");
const MAX_ZIP_DEPTH = 2;

export type IngestResult = { queued: number; duplicates: number; skipped: number };

type Target = { agentId?: string | null; section?: string | null };

async function writeTemp(buffer: Buffer | string) {
  await mkdir(TEMP_DIR, { recursive: true });
  const tempPath = path.join(TEMP_DIR, crypto.randomUUID());
  await writeFile(tempPath, buffer);
  return tempPath;
}

function isJunk(entryPath: string) {
  const parts = entryPath.split("/");
  const base = parts[parts.length - 1];
  return (
    !base ||
    parts.some((p) => p === "__MACOSX" || (p.startsWith(".") && p.length > 1)) ||
    base === "Thumbs.db" ||
    base.startsWith("~$") // Office lock files
  );
}

/**
 * Queues an uploaded file for the worker. Zips are unpacked into one queued
 * file per entry, keeping the zip's folder structure as a classification hint.
 */
export async function enqueueUpload(
  input: { buffer: Buffer; name: string; path?: string | null; mimeType?: string | null } & Target,
  depth = 0
): Promise<IngestResult> {
  const result: IngestResult = { queued: 0, duplicates: 0, skipped: 0 };

  if (extensionOf(input.name) === "zip" && depth < MAX_ZIP_DEPTH) {
    const zipBase = input.path ?? input.name.replace(/\.zip$/i, "");
    const entries = unzipSync(new Uint8Array(input.buffer), {
      filter: (f) => !f.name.endsWith("/") && !isJunk(f.name),
    });
    for (const [entryPath, data] of Object.entries(entries)) {
      const sub = await enqueueUpload(
        {
          buffer: Buffer.from(data),
          name: entryPath.split("/").pop()!,
          path: `${zipBase}/${entryPath}`,
          agentId: input.agentId,
          section: input.section,
        },
        depth + 1
      );
      result.queued += sub.queued;
      result.duplicates += sub.duplicates;
      result.skipped += sub.skipped;
    }
    return result;
  }

  if (input.buffer.length === 0 || isJunk(input.path ?? input.name)) {
    result.skipped++;
    return result;
  }

  // Same bytes already stored for the same agent (or anywhere, for central drops).
  const contentHash = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const dupConditions = [eq(files.contentHash, contentHash), ne(files.status, "failed")];
  if (input.agentId) dupConditions.push(eq(files.agentId, input.agentId));
  const [dup] = await db.select({ id: files.id }).from(files).where(and(...dupConditions)).limit(1);
  if (dup) {
    result.duplicates++;
    return result;
  }

  await db.insert(files).values({
    kind: "upload",
    agentId: input.agentId ?? null,
    section: input.section ?? null,
    name: input.name,
    path: input.path ?? null,
    mimeType: input.mimeType || null,
    size: input.buffer.length,
    contentHash,
    tempPath: await writeTemp(input.buffer),
  });
  result.queued++;
  kickWorker();
  return result;
}

export type CodeSnapshot = { root: string | null; entries: { path: string; content: string }[] };

/** Queues a filtered code folder; it replaces the project's previous snapshot once processed. */
export async function enqueueCodeSnapshot(opts: { agentId: string; snapshot: CodeSnapshot }) {
  const json = JSON.stringify(opts.snapshot);
  const size = opts.snapshot.entries.reduce((n, e) => n + e.content.length, 0);
  const [row] = await db
    .insert(files)
    .values({
      kind: "code",
      agentId: opts.agentId,
      name: opts.snapshot.root ?? "Code",
      mimeType: "application/json",
      size,
      tempPath: await writeTemp(json),
    })
    .returning({ id: files.id });
  kickWorker();
  return row.id;
}
