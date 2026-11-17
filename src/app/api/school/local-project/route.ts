import { getLocalProject, saveLocalProject } from "@/lib/school/local-project";

export const dynamic = "force-dynamic";
const MAX_ZIP_BYTES = 20_000_000;

/** Upload from scripts/sync-project.sh: a zip of the project's text files. */
export async function POST(req: Request) {
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length === 0 || body.length > MAX_ZIP_BYTES) return new Response("zip required (max 20 MB)", { status: 400 });
  try {
    const r = await saveLocalProject(body, {
      branch: (req.headers.get("x-branch") ?? "").slice(0, 100),
      commit: (req.headers.get("x-commit") ?? "").slice(0, 200),
      changed: Number(req.headers.get("x-changed")) || 0,
    });
    return new Response(`${r.files} bestanden ontvangen`);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Upload mislukt", { status: 400 });
  }
}

/** When the project was last synced, without the file contents. */
export async function GET() {
  const p = await getLocalProject();
  return Response.json(p ? { at: p.at, branch: p.branch, commit: p.commit, changed: p.changed, files: Object.keys(p.files).length } : null);
}
