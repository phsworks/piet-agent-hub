import { getGitLabStatus, listAvailableProjects, syncGitLab, trackProject, untrackProject } from "@/lib/gitlab/sync";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getGitLabStatus();
  if (!status.configured || status.error) return Response.json({ ...status, available: [] });
  const available = await listAvailableProjects().catch((err: Error) => ({ error: err.message }));
  return Response.json(
    Array.isArray(available) ? { ...status, available } : { ...status, available: [], error: available.error }
  );
}

type Body =
  | { action: "sync" }
  | { action: "track"; gitlabId: number; kind: "project" | "school" }
  | { action: "untrack"; gitlabId: number };

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  try {
    if (body.action === "sync") return Response.json(await syncGitLab());
    if (body.action === "track") {
      const row = await trackProject(Number(body.gitlabId), body.kind === "school" ? "school" : "project");
      return Response.json({ tracked: row.name });
    }
    if (body.action === "untrack") {
      await untrackProject(Number(body.gitlabId));
      return Response.json({ untracked: true });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
