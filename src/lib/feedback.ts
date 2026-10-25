import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { feedback } from "@/lib/db/schema";

export type FeedbackStatus = "open" | "applied" | "done" | "dismissed";

/** Saves something Piet wants changed about the hub. "applied" = already handled via a setting. */
export async function addFeedback(opts: { text: string; status?: FeedbackStatus; resolution?: string | null; source?: string }) {
  const status = opts.status ?? "open";
  const [row] = await db
    .insert(feedback)
    .values({
      text: opts.text,
      status,
      resolution: opts.resolution ?? null,
      source: opts.source ?? "telegram",
      resolvedAt: status === "open" ? null : new Date(),
    })
    .returning();
  return row;
}

export async function listFeedback(status?: FeedbackStatus) {
  const query = db.select().from(feedback).orderBy(desc(feedback.createdAt));
  return status ? query.where(eq(feedback.status, status)) : query;
}
