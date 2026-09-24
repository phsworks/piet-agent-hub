import { createReminder, listReminders, DUE_DATE_PATTERN } from "@/lib/reminders/store";

export const dynamic = "force-dynamic";

// Ticked-off reminders stay visible (struck through) for a while.
const KEEP_DONE_MS = 12 * 3_600_000;

export async function GET() {
  return Response.json(await listReminders({ doneSince: new Date(Date.now() - KEEP_DONE_MS) }));
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    title?: string;
    notes?: string;
    dueDate?: string | null;
    agentId?: string | null;
  };
  if (!body.title?.trim()) return new Response("Title is required", { status: 400 });
  if (body.dueDate && !DUE_DATE_PATTERN.test(body.dueDate)) {
    return new Response("Due date must be YYYY-MM-DD", { status: 400 });
  }
  const row = await createReminder({
    title: body.title,
    notes: body.notes,
    dueDate: body.dueDate,
    agentId: body.agentId,
  });
  return Response.json(row);
}
