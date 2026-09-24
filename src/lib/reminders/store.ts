import { and, asc, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, reminders } from "@/lib/db/schema";

export type Reminder = typeof reminders.$inferSelect;
export type ReminderStatus = Reminder["status"];

const columns = {
  id: reminders.id,
  title: reminders.title,
  notes: reminders.notes,
  dueDate: reminders.dueDate,
  agentId: reminders.agentId,
  agentName: agents.name,
  status: reminders.status,
  proposedBy: reminders.proposedBy,
  doneAt: reminders.doneAt,
  createdAt: reminders.createdAt,
};

/**
 * Open and proposed reminders, plus ones ticked off since `doneSince` so they
 * don't vanish the moment Piet checks them. Dated ones first, soonest first.
 */
export async function listReminders(opts: { doneSince?: Date } = {}) {
  const statusFilter = opts.doneSince
    ? or(
        inArray(reminders.status, ["open", "proposed"]),
        and(eq(reminders.status, "done"), gte(reminders.doneAt, opts.doneSince))
      )
    : inArray(reminders.status, ["open", "proposed"]);
  return db
    .select(columns)
    .from(reminders)
    .leftJoin(agents, eq(agents.id, reminders.agentId))
    .where(statusFilter)
    .orderBy(sql`${reminders.dueDate} asc nulls last`, desc(reminders.createdAt));
}

/** Reminders ticked off since a moment (for the briefing's "you finished..."). */
export async function listDoneSince(since: Date) {
  return db
    .select(columns)
    .from(reminders)
    .leftJoin(agents, eq(agents.id, reminders.agentId))
    .where(and(eq(reminders.status, "done"), gte(reminders.doneAt, since)))
    .orderBy(asc(reminders.doneAt));
}

export async function createReminder(input: {
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  agentId?: string | null;
  status?: "open" | "proposed";
  proposedBy?: string | null;
}) {
  const [row] = await db
    .insert(reminders)
    .values({
      title: input.title.trim(),
      notes: input.notes?.trim() || null,
      dueDate: input.dueDate || null,
      agentId: input.agentId || null,
      status: input.status ?? "open",
      proposedBy: input.proposedBy ?? null,
    })
    .returning();
  return row;
}

export async function updateReminder(
  id: string,
  patch: Partial<Pick<Reminder, "title" | "notes" | "dueDate" | "agentId" | "status">>
) {
  const set: Partial<Reminder> = { ...patch };
  if (patch.status) set.doneAt = patch.status === "done" ? new Date() : null;
  const [row] = await db.update(reminders).set(set).where(eq(reminders.id, id)).returning();
  return row;
}

export async function deleteReminder(id: string) {
  await db.delete(reminders).where(eq(reminders.id, id));
}

export const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
