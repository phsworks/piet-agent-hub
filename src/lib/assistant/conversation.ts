import type Anthropic from "@anthropic-ai/sdk";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { conversations, messages } from "@/lib/db/schema";
import { ASSISTANT_HISTORY_MESSAGES } from "@/lib/config";

export async function createConversation(title: string) {
  const [row] = await db
    .insert(conversations)
    .values({ title: title.slice(0, 60) })
    .returning({ id: conversations.id });
  return row.id;
}

export async function conversationExists(id: string) {
  const [row] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id));
  return Boolean(row);
}

export async function addMessage(conversationId: string, role: "user" | "assistant", content: string) {
  await db.insert(messages).values({ conversationId, role, content });
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
}

/** The last few messages, oldest first, ready to send to the API. */
export async function recentHistory(conversationId: string): Promise<Anthropic.MessageParam[]> {
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(ASSISTANT_HISTORY_MESSAGES);
  const history = rows.reverse().filter((m) => m.content.trim());
  // The API wants the first message to be Piet's.
  while (history[0]?.role === "assistant") history.shift();
  return history.map((m) => ({ role: m.role, content: m.content }));
}
