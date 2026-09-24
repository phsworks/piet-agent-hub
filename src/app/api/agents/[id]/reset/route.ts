import { getAgentById } from "@/lib/agents/registry";
import { resetNode, type ResetParts } from "@/lib/agents/create";

export const dynamic = "force-dynamic";

// Clears the chosen parts of a node: its chats, its summary and/or its files.
export async function POST(req: Request, ctx: RouteContext<"/api/agents/[id]/reset">) {
  const { id } = await ctx.params;
  if (!(await getAgentById(id))) return new Response("Not found", { status: 404 });
  const parts = (await req.json()) as ResetParts;
  await resetNode(id, parts);
  return Response.json({ ok: true });
}
