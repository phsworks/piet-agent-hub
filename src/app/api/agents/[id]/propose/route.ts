import { getAgentById } from "@/lib/agents/registry";
import { proposeNodeEdit } from "@/lib/agents/rewrite";

export const dynamic = "force-dynamic";

// Rewrites the node from a plain-language request. Returns a proposal; nothing is saved.
export async function POST(req: Request, ctx: RouteContext<"/api/agents/[id]/propose">) {
  const { id } = await ctx.params;
  if (!(await getAgentById(id))) return new Response("Not found", { status: 404 });
  const { request } = (await req.json()) as { request?: string };
  if (!request?.trim()) return new Response("Describe what should change", { status: 400 });
  return Response.json(await proposeNodeEdit(id, request));
}
