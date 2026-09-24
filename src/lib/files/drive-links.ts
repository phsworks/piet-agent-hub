import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { driveLinks, files, fileChunks } from "@/lib/db/schema";
import { getDriveFile, isFolder, listFolderRecursive, parseDriveFolderId } from "@/lib/google/drive";
import { kickWorker } from "./worker";

/** Links an existing Drive folder to an agent and indexes its files in place. */
export async function linkDriveFolder(agentId: string, urlOrId: string) {
  const folderId = parseDriveFolderId(urlOrId);
  if (!folderId) throw new Error("That doesn't look like a Drive folder link.");
  const folder = await getDriveFile(folderId);
  if (!isFolder(folder)) throw new Error("That link points to a file, not a folder.");

  const [link] = await db
    .insert(driveLinks)
    .values({ agentId, driveFolderId: folderId, name: folder.name })
    .onConflictDoUpdate({
      target: [driveLinks.agentId, driveLinks.driveFolderId],
      set: { name: folder.name },
    })
    .returning();
  const counts = await syncDriveLink(link.id);
  return { link, ...counts };
}

/** Queues new and changed files, and drops files that disappeared from the folder. */
export async function syncDriveLink(linkId: string) {
  const [link] = await db.select().from(driveLinks).where(eq(driveLinks.id, linkId));
  if (!link) throw new Error("Link not found");

  const remote = await listFolderRecursive(link.driveFolderId);
  const existing = await db.select().from(files).where(eq(files.driveLinkId, link.id));
  const byDriveId = new Map(existing.map((f) => [f.driveFileId, f]));

  let added = 0;
  let updated = 0;
  for (const r of remote) {
    const known = byDriveId.get(r.id);
    const modified = r.modifiedTime ? new Date(r.modifiedTime) : null;
    if (!known) {
      await db.insert(files).values({
        kind: "drive",
        agentId: link.agentId,
        driveLinkId: link.id,
        name: r.name,
        path: r.path,
        mimeType: r.mimeType,
        size: r.size,
        driveFileId: r.id,
        driveUrl: r.webViewLink,
        driveModifiedAt: modified,
      });
      added++;
    } else if (modified && known.driveModifiedAt?.getTime() !== modified.getTime()) {
      await db.delete(fileChunks).where(eq(fileChunks.fileId, known.id));
      await db
        .update(files)
        .set({ status: "queued", name: r.name, path: r.path, driveModifiedAt: modified, error: null })
        .where(eq(files.id, known.id));
      updated++;
    }
  }

  const remoteIds = new Set(remote.map((r) => r.id));
  const gone = existing.filter((f) => !remoteIds.has(f.driveFileId!)).map((f) => f.id);
  if (gone.length > 0) {
    await db.delete(files).where(and(eq(files.driveLinkId, link.id), inArray(files.id, gone)));
  }

  await db.update(driveLinks).set({ lastSyncedAt: new Date() }).where(eq(driveLinks.id, link.id));
  kickWorker();
  return { added, updated, removed: gone.length };
}
