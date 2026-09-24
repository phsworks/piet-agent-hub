import { getAgentById } from "@/lib/agents/registry";
import { generateOverview } from "@/lib/agents/overview";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: RouteContext<"/api/agents/[id]/overview">) {
  const { id } = await ctx.params;
  const agent = await getAgentById(id);
  if (!agent) return new Response("Not found", { status: 404 });
  const overview = await generateOverview(agent.id);
  return Response.json({ overview });
}
