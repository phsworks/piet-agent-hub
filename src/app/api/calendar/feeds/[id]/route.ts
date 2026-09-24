import { removeFeed } from "@/lib/calendar/feeds";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/calendar/feeds/[id]">) {
  const { id } = await ctx.params;
  await removeFeed(id);
  return Response.json({ ok: true });
}
