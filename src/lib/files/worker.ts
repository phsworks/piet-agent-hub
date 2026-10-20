import { readFile, unlink } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, files, fileChunks } from "@/lib/db/schema";
import { listAgents } from "@/lib/agents/registry";
import { ensureAgentFolder, uploadToDrive, getDriveFile, downloadDriveFile } from "@/lib/google/drive";
import { embedMany } from "@/lib/memory/embed";
import { extractText } from "./extract";
import { analyzeFile } from "./analyze";
import { chunkText } from "./chunk";
import { processCodeSnapshot } from "./code";
import { notifyOwner } from "@/lib/telegram/api";

type FileRow = typeof files.$inferSelect;

const CONCURRENCY = 2;

// Survives dev hot reloads, so there is only ever one worker loop.
const state = ((globalThis as unknown as { __fileWorker?: { running: number } }).__fileWorker ??= {
  running: 0,
});

/** Called on server start: resumes work interrupted by a restart. */
export async function startWorker() {
  await db.update(files).set({ status: "queued" }).where(eq(files.status, "processing"));
  kickWorker();
}

export function kickWorker() {
  while (state.running < CONCURRENCY) {
    state.running++;
    runLoop().finally(() => {
      state.running--;
    });
  }
}

async function claimNext(): Promise<FileRow | undefined> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE files SET status = 'processing', error = NULL
    WHERE id = (
      SELECT id FROM files WHERE status = 'queued'
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id`);
  const id = rows[0]?.id;
  if (!id) return undefined;
  const [row] = await db.select().from(files).where(eq(files.id, id));
  return row;
}

async function runLoop() {
  for (let file = await claimNext(); file; file = await claimNext()) {
    try {
      await processFile(file);
    } catch (err) {
      console.error(`Processing ${file.name} failed`, err);
      const error = err instanceof Error ? err.message : String(err);
      await db.update(files).set({ status: "failed", error }).where(eq(files.id, file.id));
      if (file.source === "telegram") await notifyOwner(`⚠️ ${file.name} verwerken mislukt: ${error}`);
    }
  }
}

async function processFile(file: FileRow) {
  if (file.kind === "code") {
    await processCodeSnapshot(file);
  } else {
    await processDocument(file);
  }
  if (file.tempPath) await unlink(file.tempPath).catch(() => {});
  if (file.source === "telegram") await notifyFiled(file.id);
}

/** Tells Piet on Telegram where a file he sent ended up. */
async function notifyFiled(fileId: string) {
  const [row] = await db
    .select({ name: files.name, summary: files.summary, driveUrl: files.driveUrl, folder: agents.name })
    .from(files)
    .leftJoin(agents, eq(agents.id, files.agentId))
    .where(eq(files.id, fileId));
  if (!row) return;
  const lines = [`✓ ${row.name} opgeslagen${row.folder ? ` in ${row.folder}` : ""}`];
  if (row.summary) lines.push("", row.summary);
  if (row.driveUrl) lines.push("", row.driveUrl);
  await notifyOwner(lines.join("\n"));
}

async function processDocument(file: FileRow) {
  const allAgents = await listAgents();

  let buffer: Buffer | null;
  let readableName = file.name;
  if (file.kind === "upload") {
    if (!file.tempPath) throw new Error("Upload data is gone (app restarted after a reboot?). Upload the file again.");
    buffer = await readFile(file.tempPath).catch(() => {
      throw new Error("Upload data is gone (temp file removed). Upload the file again.");
    });
  } else {
    const meta = await getDriveFile(file.driveFileId!);
    const download = await downloadDriveFile(meta);
    buffer = download?.buffer ?? null;
    readableName = download?.name ?? file.name;
  }

  const text = buffer ? await extractText(buffer, readableName) : null;
  const fixedAgent = file.agentId ? allAgents.find((a) => a.id === file.agentId) : undefined;
  const analysis = await analyzeFile({
    name: file.name,
    path: file.path,
    text,
    note: file.note,
    allAgents,
    fixedAgent,
    fixedSection: file.section,
  });

  const updates: Partial<FileRow> = {
    agentId: analysis.agentId,
    section: analysis.section,
    summary: analysis.summary,
  };

  if (file.kind === "upload" && !file.driveFileId) {
    const folderId = await ensureAgentFolder(analysis.agentId, analysis.section);
    const uploaded = await uploadToDrive({
      name: file.name,
      mimeType: file.mimeType ?? "application/octet-stream",
      body: buffer!,
      folderId,
    });
    Object.assign(updates, {
      driveFileId: uploaded.id,
      driveUrl: uploaded.webViewLink,
      driveModifiedAt: uploaded.modifiedTime ? new Date(uploaded.modifiedTime) : null,
    });
    // Persist right away so a later failure doesn't upload the file twice on retry.
    await db.update(files).set(updates).where(eq(files.id, file.id));
  }

  // Piet's caption is searchable too, also for photos without readable text.
  const searchable = [file.note && `Notitie van Piet: ${file.note}`, text].filter(Boolean).join("\n\n");
  await replaceChunks(
    file.id,
    searchable ? chunkText(searchable).map((content) => ({ content, path: null })) : [],
    file.name
  );

  await db
    .update(files)
    .set({ ...updates, status: "ready", error: null, tempPath: null, processedAt: new Date() })
    .where(eq(files.id, file.id));
}

/** Replaces a file's chunks. The file name is embedded with each chunk to help search. */
export async function replaceChunks(
  fileId: string,
  chunks: { content: string; path: string | null }[],
  label: string
) {
  await db.delete(fileChunks).where(eq(fileChunks.fileId, fileId));
  if (chunks.length === 0) return;
  const embeddings = await embedMany(chunks.map((c) => `${c.path ?? label}\n${c.content}`));
  const rows = chunks.map((c, i) => ({
    fileId,
    chunkIndex: i,
    path: c.path,
    content: c.content,
    embedding: embeddings[i],
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(fileChunks).values(rows.slice(i, i + 500));
  }
}
