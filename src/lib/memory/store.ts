import { sql, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memories } from "@/lib/db/schema";
import { embed } from "./embed";
import { MEMORY_SIMILARITY_THRESHOLD } from "@/lib/config";

function toVectorLiteral(vec: number[]) {
  return JSON.stringify(vec);
}

export async function searchMemories(query: string, limit = 5) {
  const queryEmbedding = await embed(query);
  const literal = toVectorLiteral(queryEmbedding);
  const similarity = sql<number>`1 - (${memories.embedding} <=> ${literal}::vector)`;

  const rows = await db
    .select({
      id: memories.id,
      content: memories.content,
      category: memories.category,
      branch: memories.branch,
      similarity,
    })
    .from(memories)
    .orderBy(desc(similarity))
    .limit(limit);

  return rows;
}

export async function saveMemory(input: {
  content: string;
  category?: string;
  branch?: string;
  source?: string;
}) {
  const embedding = await embed(input.content);
  const literal = toVectorLiteral(embedding);
  const similarity = sql<number>`1 - (${memories.embedding} <=> ${literal}::vector)`;

  const [closest] = await db
    .select({ id: memories.id, similarity })
    .from(memories)
    .orderBy(desc(similarity))
    .limit(1);

  if (closest && closest.similarity >= MEMORY_SIMILARITY_THRESHOLD) {
    const [updated] = await db
      .update(memories)
      .set({
        content: input.content,
        category: input.category ?? "fact",
        branch: input.branch ?? "general",
        source: input.source,
        embedding,
        updatedAt: new Date(),
      })
      .where(sql`${memories.id} = ${closest.id}`)
      .returning({ id: memories.id });

    return { id: updated.id, action: "updated" as const };
  }

  const [created] = await db
    .insert(memories)
    .values({
      content: input.content,
      category: input.category ?? "fact",
      branch: input.branch ?? "general",
      source: input.source,
      embedding,
    })
    .returning({ id: memories.id });

  return { id: created.id, action: "created" as const };
}

export async function listMemories() {
  return db
    .select({
      id: memories.id,
      content: memories.content,
      category: memories.category,
      branch: memories.branch,
      createdAt: memories.createdAt,
      updatedAt: memories.updatedAt,
    })
    .from(memories)
    .orderBy(desc(memories.updatedAt));
}

export async function deleteMemory(id: string) {
  await db.delete(memories).where(sql`${memories.id} = ${id}`);
}

export async function updateMemoryContent(id: string, content: string) {
  const embedding = await embed(content);
  await db
    .update(memories)
    .set({ content, embedding, updatedAt: new Date() })
    .where(sql`${memories.id} = ${id}`);
}
