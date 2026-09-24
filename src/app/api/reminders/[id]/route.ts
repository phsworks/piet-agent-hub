import { deleteReminder, updateReminder, DUE_DATE_PATTERN, type ReminderStatus } from "@/lib/reminders/store";

export const dynamic = "force-dynamic";

const STATUSES: ReminderStatus[] = ["proposed", "open", "done"];

export async function PATCH(req: Request, ctx: RouteContext<"/api/reminders/[id]">) {
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    title?: string;
    notes?: string | null;
    dueDate?: string | null;
    agentId?: string | null;
    status?: ReminderStatus;
  };
  if (body.status && !STATUSES.includes(body.status)) {
    return new Response("Invalid status", { status: 400 });
  }
  if (body.dueDate && !DUE_DATE_PATTERN.test(body.dueDate)) {
    return new Response("Due date must be YYYY-MM-DD", { status: 400 });
  }
  if (body.title !== undefined && !body.title.trim()) {
    return new Response("Title can't be empty", { status: 400 });
  }
  const row = await updateReminder(id, {
    ...(body.title !== undefined && { title: body.title.trim() }),
    ...(body.notes !== undefined && { notes: body.notes }),
    ...(body.dueDate !== undefined && { dueDate: body.dueDate || null }),
    ...(body.agentId !== undefined && { agentId: body.agentId || null }),
    ...(body.status && { status: body.status }),
  });
  if (!row) return new Response("Not found", { status: 404 });
  return Response.json(row);
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/reminders/[id]">) {
  const { id } = await ctx.params;
  await deleteReminder(id);
  return Response.json({ ok: true });
}
