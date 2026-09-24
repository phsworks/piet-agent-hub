import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, fileChunks, files } from "@/lib/db/schema";
import { embed } from "@/lib/memory/embed";

/** Semantic search over indexed file chunks, optionally limited to some agents. */
export async function searchFiles(query: string, opts: { agentIds?: string[]; limit?: number } = {}) {
  const literal = JSON.stringify(await embed(query));
  const similarity = sql<number>`1 - (${fileChunks.embedding} <=> ${literal}::vector)`;

  const conditions = [eq(files.status, "ready")];
  if (opts.agentIds) conditions.push(inArray(files.agentId, opts.agentIds));

  return db
    .select({
      file: files.name,
      fileId: files.id,
      agent: agents.name,
      section: files.section,
      kind: files.kind,
      path: fileChunks.path,
      driveUrl: files.driveUrl,
      content: fileChunks.content,
      similarity,
    })
    .from(fileChunks)
    .innerJoin(files, eq(fileChunks.fileId, files.id))
    .leftJoin(agents, eq(files.agentId, agents.id))
    .where(and(...conditions))
    .orderBy(desc(similarity))
    .limit(opts.limit ?? 8);
}
