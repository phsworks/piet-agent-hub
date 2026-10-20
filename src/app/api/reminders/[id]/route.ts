import { completeTask, deleteTask } from "@/lib/ticktick/client";

export const dynamic = "force-dynamic";

// id is "projectId:taskId" (see Task.id). Only ticking off is supported here;
// everything else is easier in the TickTick app.
export async function PATCH(req: Request, ctx: RouteContext<"/api/reminders/[id]">) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { status?: string };
  if (body.status !== "done") return new Response("Only {status: \"done\"} is supported", { status: 400 });
  await completeTask(decodeURIComponent(id));
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/reminders/[id]">) {
  const { id } = await ctx.params;
  await deleteTask(decodeURIComponent(id));
  return Response.json({ ok: true });
}
