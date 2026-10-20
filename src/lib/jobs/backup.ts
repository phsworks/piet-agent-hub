import { spawn } from "node:child_process";
import { getSetting, setSetting } from "@/lib/settings";
import { ensureRootSubfolder, listFolderFiles, trashDriveFile, uploadToDrive } from "@/lib/google/drive";
import { getGoogleStatus, isExpiredGrant } from "@/lib/google/auth";
import { dayKey } from "@/lib/dates";
import { notifyOwner } from "@/lib/telegram/api";

// Nightly database backup to Drive (/PietBrain/Backups). Only on the VPS
// (BACKUP_TO_DRIVE=true), so a dev database never overwrites the real backups.
const KEEP = 14;
const STATE_KEY = "backup_last";
const WARNED_KEY = "backup_warned";
// A missed backup (server was down) is made on start once it's this old.
export const BACKUP_STALE_MS = 26 * 3_600_000;

export function backupsEnabled() {
  return process.env.BACKUP_TO_DRIVE === "true";
}

/** pg_dump in custom format: compressed, restorable with pg_restore. */
function dump(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("pg_dump", ["--format=custom", "--no-owner", process.env.DATABASE_URL!]);
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`pg_dump exited ${code}: ${stderr}`))));
  });
}

export async function lastBackupAt() {
  return (await getSetting<{ at: string }>(STATE_KEY))?.at ?? null;
}

export async function runBackup() {
  if (!backupsEnabled()) return;
  if (!(await getGoogleStatus()).connected) {
    console.error("[backup] skipped: Google isn't connected");
    return;
  }
  try {
    const data = await dump();
    const folderId = await ensureRootSubfolder("Backups");
    await uploadToDrive({ name: `piet-brain-${dayKey()}.dump`, mimeType: "application/octet-stream", body: data, folderId });
    const old = (await listFolderFiles(folderId)).filter((f) => f.name.endsWith(".dump")).slice(KEEP);
    for (const file of old) await trashDriveFile(file.id);
    await setSetting(STATE_KEY, { at: new Date().toISOString(), bytes: data.length });
    console.log(`[backup] ${Math.round(data.length / 1024)} KB to Drive, ${old.length} old removed`);
  } catch (err) {
    console.error("[backup] failed", err);
    // One message per problem per day is enough; the 03:30 run shouldn't wake Piet with a repeat.
    const lastWarned = await getSetting<string>(WARNED_KEY);
    if (lastWarned && Date.now() - Date.parse(lastWarned) < 24 * 3_600_000) return;
    await setSetting(WARNED_KEY, new Date().toISOString());
    await notifyOwner(
      isExpiredGrant(err)
        ? "⚠️ Backup niet gelukt: de Google-koppeling is verlopen. Koppel Google opnieuw in Settings, dan gaat de backup vannacht weer goed."
        : `⚠️ De nachtelijke backup is mislukt: ${err instanceof Error ? err.message.slice(0, 200) : err}`
    );
  }
}
