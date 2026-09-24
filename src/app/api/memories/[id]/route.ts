import { deleteMemory, updateMemoryContent } from "@/lib/memory/store";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/memories/[id]">
) {
  const { id } = await ctx.params;
  const { content } = (await req.json()) as { content?: string };

  if (!content || typeof content !== "string") {
    return new Response("Missing content", { status: 400 });
  }

  await updateMemoryContent(id, content);
  return Response.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/memories/[id]">
) {
  const { id } = await ctx.params;
  await deleteMemory(id);
  return Response.json({ ok: true });
}
