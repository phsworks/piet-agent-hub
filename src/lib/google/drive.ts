import { Readable } from "node:stream";
import { drive as driveApi, type drive_v3 } from "@googleapis/drive";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, driveFolders } from "@/lib/db/schema";
import { getAuthedClient } from "./auth";
import { getSetting, setSetting } from "@/lib/settings";
import { DRIVE_ROOT_FOLDER, PROJECT_SECTIONS, BRAIN_SLUG } from "@/lib/config";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_KEY = "drive_root_folder_id";
const FILE_FIELDS = "id, name, mimeType, size, modifiedTime, webViewLink, parents";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  webViewLink: string | null;
};

// Google-native files have no bytes to download; export them as text instead.
const EXPORT_AS: Record<string, { mimeType: string; ext: string }> = {
  "application/vnd.google-apps.document": { mimeType: "text/plain", ext: "txt" },
  "application/vnd.google-apps.presentation": { mimeType: "text/plain", ext: "txt" },
  "application/vnd.google-apps.spreadsheet": { mimeType: "text/csv", ext: "csv" },
};

export async function getDrive(): Promise<drive_v3.Drive> {
  return driveApi({ version: "v3", auth: await getAuthedClient() });
}

function toDriveFile(f: drive_v3.Schema$File): DriveFile {
  return {
    id: f.id!,
    name: f.name ?? "(untitled)",
    mimeType: f.mimeType ?? "application/octet-stream",
    size: f.size ? Number(f.size) : null,
    modifiedTime: f.modifiedTime ?? null,
    webViewLink: f.webViewLink ?? null,
  };
}

function escapeQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function httpStatus(err: unknown) {
  return (err as { status?: number; code?: number })?.status ?? (err as { code?: number })?.code;
}

async function folderExists(drive: drive_v3.Drive, id: string) {
  try {
    const res = await drive.files.get({ fileId: id, fields: "id, trashed" });
    return !res.data.trashed;
  } catch (err) {
    if (httpStatus(err) === 404) return false;
    throw err;
  }
}

async function createFolder(drive: drive_v3.Drive, name: string, parentId?: string) {
  const res = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined },
    fields: "id",
  });
  return res.data.id!;
}

async function ensureRootFolder(drive: drive_v3.Drive) {
  const cached = await getSetting<string>(ROOT_KEY);
  if (cached && (await folderExists(drive, cached))) return cached;
  const id = await createFolder(drive, DRIVE_ROOT_FOLDER);
  await setSetting(ROOT_KEY, id);
  return id;
}

/**
 * Drive folder for an agent (and optionally one of its project sections),
 * mirroring the agent tree: /PietBrain/School/Semester 3/<Project>/Feedback.
 * Folder ids are cached in drive_folders and recreated if Piet deletes them.
 */
export async function ensureAgentFolder(agentId: string, section?: string | null) {
  const drive = await getDrive();
  const allAgents = await db.select().from(agents);
  const byId = new Map(allAgents.map((a) => [a.id, a]));

  const ensure = async (id: string, sectionKey: string): Promise<string> => {
    const [cached] = await db
      .select()
      .from(driveFolders)
      .where(and(eq(driveFolders.agentId, id), eq(driveFolders.section, sectionKey)));
    if (cached && (await folderExists(drive, cached.driveFolderId))) {
      return cached.driveFolderId;
    }

    const agent = byId.get(id)!;
    let parentFolder: string;
    let name: string;
    if (sectionKey) {
      parentFolder = await ensure(id, "");
      name = PROJECT_SECTIONS.find((s) => s.key === sectionKey)?.label ?? sectionKey;
    } else if (agent.slug === BRAIN_SLUG) {
      // Files the Brain couldn't place land in an inbox at the root.
      parentFolder = await ensureRootFolder(drive);
      name = "Inbox";
    } else {
      const parent = agent.parentId ? byId.get(agent.parentId) : undefined;
      parentFolder =
        !parent || parent.slug === BRAIN_SLUG
          ? await ensureRootFolder(drive)
          : await ensure(parent.id, "");
      name = agent.name;
    }

    const folderId = await createFolder(drive, name, parentFolder);
    await db
      .insert(driveFolders)
      .values({ agentId: id, section: sectionKey, driveFolderId: folderId })
      .onConflictDoUpdate({
        target: [driveFolders.agentId, driveFolders.section],
        set: { driveFolderId: folderId },
      });
    return folderId;
  };

  return ensure(agentId, section ?? "");
}

export async function uploadToDrive(opts: {
  name: string;
  mimeType: string;
  body: Buffer;
  folderId: string;
}): Promise<DriveFile> {
  const drive = await getDrive();
  const res = await drive.files.create({
    requestBody: { name: opts.name, parents: [opts.folderId] },
    media: { mimeType: opts.mimeType, body: Readable.from(opts.body) },
    fields: FILE_FIELDS,
  });
  return toDriveFile(res.data);
}

/** A folder directly under /PietBrain (e.g. "Backups"), created on first use. */
export async function ensureRootSubfolder(name: string) {
  const drive = await getDrive();
  const key = `drive_subfolder:${name}`;
  const cached = await getSetting<string>(key);
  if (cached && (await folderExists(drive, cached))) return cached;
  const id = await createFolder(drive, name, await ensureRootFolder(drive));
  await setSetting(key, id);
  return id;
}

/** Files directly in a folder, newest first. */
export async function listFolderFiles(folderId: string) {
  const drive = await getDrive();
  const res = await drive.files.list({
    q: `'${escapeQuery(folderId)}' in parents and trashed = false`,
    fields: `files(${FILE_FIELDS})`,
    orderBy: "createdTime desc",
    pageSize: 100,
  });
  return (res.data.files ?? []).map(toDriveFile);
}

export async function trashDriveFile(fileId: string) {
  const drive = await getDrive();
  await drive.files.update({ fileId, requestBody: { trashed: true } });
}

/** Creates a Google Doc from plain text (used by agents to write notes). */
export async function createGoogleDoc(opts: {
  name: string;
  text: string;
  folderId: string;
}): Promise<DriveFile> {
  const drive = await getDrive();
  const res = await drive.files.create({
    requestBody: {
      name: opts.name,
      mimeType: "application/vnd.google-apps.document",
      parents: [opts.folderId],
    },
    media: { mimeType: "text/plain", body: Readable.from(Buffer.from(opts.text, "utf8")) },
    fields: FILE_FIELDS,
  });
  return toDriveFile(res.data);
}

/** Full-text search across all of Piet's Drive. */
export async function searchDrive(query: string, limit = 10): Promise<DriveFile[]> {
  const drive = await getDrive();
  const q = escapeQuery(query);
  const res = await drive.files.list({
    q: `(name contains '${q}' or fullText contains '${q}') and trashed = false and mimeType != '${FOLDER_MIME}'`,
    pageSize: limit,
    fields: `files(${FILE_FIELDS})`,
    orderBy: "modifiedTime desc",
    spaces: "drive",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  return (res.data.files ?? []).map(toDriveFile);
}

export async function getDriveFile(fileId: string): Promise<DriveFile> {
  const drive = await getDrive();
  const res = await drive.files.get({ fileId, fields: FILE_FIELDS, supportsAllDrives: true });
  return toDriveFile(res.data);
}

export function isFolder(file: DriveFile) {
  return file.mimeType === FOLDER_MIME;
}

/** Returns the file's bytes; Google-native docs are exported to text first. */
export async function downloadDriveFile(
  file: DriveFile
): Promise<{ buffer: Buffer; mimeType: string; name: string } | null> {
  const drive = await getDrive();
  const exportAs = EXPORT_AS[file.mimeType];
  if (exportAs) {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: exportAs.mimeType },
      { responseType: "arraybuffer" }
    );
    return {
      buffer: Buffer.from(res.data as ArrayBuffer),
      mimeType: exportAs.mimeType,
      name: `${file.name}.${exportAs.ext}`,
    };
  }
  if (file.mimeType.startsWith("application/vnd.google-apps.")) {
    return null; // forms, drawings, shortcuts: nothing useful to read
  }
  const res = await drive.files.get(
    { fileId: file.id, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return { buffer: Buffer.from(res.data as ArrayBuffer), mimeType: file.mimeType, name: file.name };
}

/** All files under a folder (recursive), with their path relative to it. */
export async function listFolderRecursive(
  folderId: string,
  maxFiles = 1000
): Promise<(DriveFile & { path: string })[]> {
  const drive = await getDrive();
  const out: (DriveFile & { path: string })[] = [];
  const queue: { id: string; path: string }[] = [{ id: folderId, path: "" }];

  while (queue.length > 0 && out.length < maxFiles) {
    const folder = queue.shift()!;
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${escapeQuery(folder.id)}' in parents and trashed = false`,
        pageSize: 200,
        pageToken,
        fields: `nextPageToken, files(${FILE_FIELDS})`,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      });
      for (const f of res.data.files ?? []) {
        const file = toDriveFile(f);
        const path = folder.path ? `${folder.path}/${file.name}` : file.name;
        if (isFolder(file)) queue.push({ id: file.id, path });
        else if (out.length < maxFiles) out.push({ ...file, path });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken && out.length < maxFiles);
  }
  return out;
}

/** Accepts a Drive folder URL or a bare id. */
export function parseDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/) ?? trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (fromUrl) return fromUrl[1];
  return /^[a-zA-Z0-9_-]{10,}$/.test(trimmed) ? trimmed : null;
}

/** Renames the agent's own Drive folder, if the app created one. Missing folders are ignored. */
export async function renameAgentFolder(agentId: string, name: string) {
  const [cached] = await db
    .select()
    .from(driveFolders)
    .where(and(eq(driveFolders.agentId, agentId), eq(driveFolders.section, "")));
  if (!cached) return;
  const drive = await getDrive();
  if (!(await folderExists(drive, cached.driveFolderId))) return;
  await drive.files.update({ fileId: cached.driveFolderId, requestBody: { name } });
}
