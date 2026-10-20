import { TIMEZONE } from "@/lib/config";
import { dayKey, timeKey, zonedDate } from "@/lib/dates";
import { getTickTickToken, TickTickNotConnectedError } from "./auth";

const API = "https://api.ticktick.com/open/v1";
// Tasks are read live (TickTick is the source of truth); this only stops one
// question or page load from fetching every list several times.
const CACHE_MS = 60_000;
// The inbox isn't in the project list, but its data is readable under this alias.
const INBOX = "inbox";

type RawProject = { id: string; name: string; closed?: boolean; kind?: string };
type RawTask = {
  id: string;
  projectId: string;
  title: string;
  content?: string;
  desc?: string;
  isAllDay?: boolean;
  dueDate?: string;
  repeatFlag?: string;
  priority?: number;
  status?: number;
};

export type TaskList = { id: string; name: string };

export type Task = {
  /** "projectId:taskId", so one string is enough to complete or delete it. */
  id: string;
  title: string;
  notes: string | null;
  list: string;
  /** Exact due moment (ISO), or null without a date. */
  due: string | null;
  /** YYYY-MM-DD in Piet's timezone. */
  dueDay: string | null;
  /** HH:mm, or null for an all-day task. */
  dueTime: string | null;
  priority: number;
  recurring: boolean;
};

async function tt<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getTickTickToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401) throw new TickTickNotConnectedError("TickTick rejected the token. Reconnect it in Settings.");
  if (!res.ok) throw new Error(`TickTick ${method} ${path} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** TickTick writes dates as 2019-11-14T03:00:00+0000; JS wants a colon in the offset. */
function parseDate(value: string) {
  return new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

function formatDate(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "+0000");
}

const cache: { tasks?: Task[]; lists?: TaskList[]; at: number } = { at: 0 };

export function invalidateTasks() {
  cache.at = 0;
}

export async function listTaskLists(): Promise<TaskList[]> {
  const projects = await tt<RawProject[]>("GET", "/project");
  return [
    { id: INBOX, name: "Inbox" },
    ...projects.filter((p) => !p.closed && (p.kind ?? "TASK") === "TASK").map((p) => ({ id: p.id, name: p.name })),
  ];
}

function toTask(raw: RawTask, list: string): Task {
  const due = raw.dueDate ? parseDate(raw.dueDate) : null;
  return {
    id: `${raw.projectId}:${raw.id}`,
    title: raw.title,
    notes: raw.content || raw.desc || null,
    list,
    due: due?.toISOString() ?? null,
    dueDay: due ? dayKey(due) : null,
    dueTime: due && !raw.isAllDay ? timeKey(due) : null,
    priority: raw.priority ?? 0,
    recurring: Boolean(raw.repeatFlag),
  };
}

/** All open tasks over every list, dated ones first (soonest first). */
export async function listTasks(): Promise<Task[]> {
  if (cache.tasks && Date.now() - cache.at < CACHE_MS) return cache.tasks;
  const lists = await listTaskLists();
  const perList = await Promise.all(
    lists.map(async (list) => {
      const data = await tt<{ tasks?: RawTask[] }>("GET", `/project/${list.id}/data`).catch((err) => {
        // One broken list (e.g. a shared one) shouldn't hide the rest.
        if (err instanceof TickTickNotConnectedError) throw err;
        console.error(`[ticktick] reading list "${list.name}" failed`, err);
        return { tasks: [] };
      });
      return (data.tasks ?? []).filter((t) => (t.status ?? 0) === 0).map((t) => toTask(t, list.name));
    })
  );
  const tasks = perList.flat().sort((a, b) => {
    if (a.due && b.due) return a.due.localeCompare(b.due);
    return a.due ? -1 : b.due ? 1 : 0;
  });
  cache.tasks = tasks;
  cache.lists = lists;
  cache.at = Date.now();
  return tasks;
}

/** Case-insensitive match on a list name ("school" finds "📚 School"). */
export async function findList(name: string) {
  const lists = cache.lists && Date.now() - cache.at < CACHE_MS ? cache.lists : await listTaskLists();
  const wanted = name.trim().toLowerCase();
  const plain = (n: string) => n.replace(/[^\p{L}\p{N} ]/gu, "").trim().toLowerCase();
  return (
    lists.find((l) => l.name.toLowerCase() === wanted) ??
    lists.find((l) => plain(l.name) === plain(wanted)) ??
    lists.find((l) => plain(l.name).includes(plain(wanted))) ?? { missing: true as const, lists }
  );
}

export async function createTask(input: {
  title: string;
  notes?: string | null;
  /** YYYY-MM-DD */
  dueDay?: string | null;
  /** HH:mm; without it the task is all-day with a reminder at 9:00. */
  dueTime?: string | null;
  listId?: string | null;
}) {
  const timed = Boolean(input.dueDay && input.dueTime);
  const body: Record<string, unknown> = {
    title: input.title.trim(),
    ...(input.notes && { content: input.notes }),
    ...(input.listId && input.listId !== INBOX && { projectId: input.listId }),
  };
  if (input.dueDay) {
    const due = zonedDate(input.dueDay, timed ? input.dueTime! : "00:00");
    Object.assign(body, {
      dueDate: formatDate(due),
      startDate: formatDate(due),
      isAllDay: !timed,
      timeZone: TIMEZONE,
      // Timed: at the moment itself. All-day: 9:00 that day.
      reminders: [timed ? "TRIGGER:PT0S" : "TRIGGER:P0DT9H0M0S"],
    });
  }
  const raw = await tt<RawTask>("POST", "/task", body);
  invalidateTasks();
  const lists = cache.lists ?? (await listTaskLists());
  return toTask(raw, lists.find((l) => l.id === raw.projectId)?.name ?? "Inbox");
}

function splitId(id: string) {
  const [projectId, taskId] = id.split(":");
  if (!projectId || !taskId) throw new Error("Invalid task id");
  return { projectId, taskId };
}

export async function completeTask(id: string) {
  const { projectId, taskId } = splitId(id);
  await tt("POST", `/project/${projectId}/task/${taskId}/complete`);
  invalidateTasks();
}

export async function deleteTask(id: string) {
  const { projectId, taskId } = splitId(id);
  await tt("DELETE", `/project/${projectId}/task/${taskId}`);
  invalidateTasks();
}

/** Moves a task to another day, keeping its time (or all-day). */
export async function rescheduleTask(id: string, dueDay: string, dueTime: string | null) {
  const { projectId, taskId } = splitId(id);
  const due = zonedDate(dueDay, dueTime ?? "00:00");
  await tt("POST", `/task/${taskId}`, {
    id: taskId,
    projectId,
    dueDate: formatDate(due),
    startDate: formatDate(due),
    isAllDay: !dueTime,
    timeZone: TIMEZONE,
  });
  invalidateTasks();
}
