import { listAgents } from "@/lib/agents/registry";

export const dynamic = "force-dynamic";

// The folder tree (used for labels and pickers in the UI).
export async function GET() {
  const agents = await listAgents();
  return Response.json(
    agents.map((a) => ({
      id: a.id,
      slug: a.slug,
      parentId: a.parentId,
      name: a.name,
      branch: a.branch,
      position: a.position,
    }))
  );
}
