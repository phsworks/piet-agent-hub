import { NextRequest } from "next/server";
import { desc, eq, inArray, and, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, files } from "@/lib/db/schema";
import { FILE_COLUMNS } from "@/lib/files/queries";

export const dynamic = "force-dynamic";

// ?agentId= filters to one agent; ?status= to one status.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const conditions: SQL[] = [];
  const agentId = params.get("agentId");
  const status = params.get("status");
  if (agentId) conditions.push(eq(files.agentId, agentId));
  if (status) {
    conditions.push(inArray(files.status, status.split(",") as (typeof files.$inferSelect.status)[]));
  }

  const rows = await db
    .select(FILE_COLUMNS)
    .from(files)
    .leftJoin(agents, eq(files.agentId, agents.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(files.createdAt))
    .limit(500);
  return Response.json(rows);
}
