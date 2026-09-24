import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents } from "@/lib/db/schema";

export type Agent = typeof agents.$inferSelect;

export async function listAgents(): Promise<Agent[]> {
  return db.select().from(agents).orderBy(asc(agents.position));
}

export async function getAgentById(id: string): Promise<Agent | undefined> {
  const [row] = await db.select().from(agents).where(eq(agents.id, id));
  return row;
}

export async function getAgentBySlug(slug: string): Promise<Agent | undefined> {
  const [row] = await db.select().from(agents).where(eq(agents.slug, slug));
  return row;
}

/** The agent's id plus all its descendants' ids. */
export function subtreeIds(allAgents: Agent[], rootId: string): string[] {
  const ids = [rootId];
  for (let i = 0; i < ids.length; i++) {
    for (const a of allAgents) if (a.parentId === ids[i]) ids.push(a.id);
  }
  return ids;
}
