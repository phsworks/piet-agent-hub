import { NextRequest } from "next/server";
import { listAgents } from "@/lib/agents/registry";
import { createNode } from "@/lib/agents/create";

export const dynamic = "force-dynamic";

export async function GET() {
  const agents = await listAgents();
  return Response.json(
    agents.map((a) => ({
      id: a.id,
      slug: a.slug,
      parentId: a.parentId,
      name: a.name,
      branch: a.branch,
      description: a.description,
      systemPrompt: a.systemPrompt,
      icon: a.icon,
      position: a.position,
      kind: a.kind,
    }))
  );
}

// Adds a node under any existing one.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    name?: string;
    parentId?: string;
    description?: string;
    isProject?: boolean;
  };
  if (!body.name?.trim() || !body.parentId) {
    return new Response("Name and parent are required", { status: 400 });
  }
  try {
    const node = await createNode({
      name: body.name,
      parentId: body.parentId,
      description: body.description,
      isProject: body.isProject,
    });
    return Response.json({ id: node.id, slug: node.slug });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Failed", { status: 400 });
  }
}
