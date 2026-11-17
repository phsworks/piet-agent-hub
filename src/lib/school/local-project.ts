import { unzipSync } from "fflate";
import { getSetting, setSetting } from "@/lib/settings";

// The Kova project as it is on Piet's Mac, sent by scripts/sync-project.sh.
// Text files only (~1 MB), kept in one setting so the generator can read the
// code without GitLab and including work that isn't pushed yet.

const KEY = "school_local_project";
const MAX_FILE_BYTES = 200_000;
const MAX_TOTAL_BYTES = 8_000_000;

export type LocalProject = { at: string; branch: string; commit: string; changed: number; files: Record<string, string> };

/** Safe relative path, no secrets: the script filters too, but the hub doesn't trust it. */
export const allowedPath = (p: string) =>
  !p.startsWith("/") && !p.split("/").includes("..") && !/(^|\/)\.env/.test(p) && !/(^|\/)[^/]*(secret|credential|service-account|private-key)[^/]*$/i.test(p) && !/(^|\/)node_modules\//.test(p) && !p.endsWith("/");

export async function saveLocalProject(zip: Uint8Array, meta: { branch: string; commit: string; changed: number }) {
  const entries = unzipSync(zip);
  const files: Record<string, string> = {};
  let total = 0;
  for (const [path, bytes] of Object.entries(entries)) {
    if (!allowedPath(path) || bytes.length > MAX_FILE_BYTES) continue;
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new Error("Project te groot (meer dan 8 MB tekst)");
    files[path] = new TextDecoder().decode(bytes);
  }
  if (Object.keys(files).length === 0) throw new Error("Geen bestanden in de upload");
  const project: LocalProject = { at: new Date().toISOString(), ...meta, files };
  await setSetting(KEY, project);
  return { files: Object.keys(files).length, bytes: total };
}

export const getLocalProject = () => getSetting<LocalProject>(KEY);

// Self-check: traversal, absolute paths, .env and node_modules are refused.
for (const [p, ok] of [["kova-backend/src/app.ts", true], ["../etc/passwd", false], ["/etc/x", false], ["kova-backend/.env.local", false], ["a/node_modules/b.js", false], ["config/google-credentials.json", false]] as const) {
  if (allowedPath(p) !== ok) throw new Error(`allowedPath self-check failed for ${p}`);
}
