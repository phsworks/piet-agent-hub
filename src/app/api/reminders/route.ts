import { createTask, listTasks } from "@/lib/ticktick/client";
import { TickTickNotConnectedError } from "@/lib/ticktick/auth";
import { parseQuickTask } from "@/lib/telegram/quick";
import { DAY_PATTERN } from "@/lib/dates";

export const dynamic = "force-dynamic";

// Reminders are TickTick tasks now; this route just proxies them for the home page.
export async function GET() {
  try {
    const tasks = await listTasks();
    return Response.json({ connected: true, tasks });
  } catch (err) {
    if (err instanceof TickTickNotConnectedError) return Response.json({ connected: false, tasks: [], error: err.message });
    throw err;
  }
}

export async function POST(req: Request) {
  const body = (await req.json()) as { title?: string; dueDate?: string | null };
  if (!body.title?.trim()) return new Response("Title is required", { status: 400 });
  if (body.dueDate && !DAY_PATTERN.test(body.dueDate)) {
    return new Response("Due date must be YYYY-MM-DD", { status: 400 });
  }
  // Without a picked date, "morgen 9:00 mail docent" works like /t in Telegram.
  const parsed = body.dueDate ? { title: body.title, dueDay: body.dueDate, dueTime: null } : parseQuickTask(body.title);
  return Response.json(await createTask(parsed));
}

