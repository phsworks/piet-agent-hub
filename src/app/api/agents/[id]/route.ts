import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, driveLinks, files } from "@/lib/db/schema";
import { getAgentById } from "@/lib/agents/registry";
import { updateNode } from "@/lib/agents/create";
import { renameAgentFolder } from "@/lib/google/drive";
import { FILE_COLUMNS } from "@/lib/files/queries";
import { saveMemory } from "@/lib/memory/store";

export const dynamic = "force-dynamic";

// Everything the node panel's overview tab shows.
export async function GET(_req: Request, ctx: RouteContext<"/api/agents/[id]">) {
  const { id } = await ctx.params;
  const agent = await getAgentById(id);
  if (!agent) return new Response("Not found", { status: 404 });

  const [nodeFiles, links] = await Promise.all([
    db
      .select(FILE_COLUMNS)
      .from(files)
      .leftJoin(agents, eq(files.agentId, agents.id))
      .where(eq(files.agentId, agent.id))
      .orderBy(desc(files.createdAt)),
    db.select().from(driveLinks).where(eq(driveLinks.agentId, agent.id)),
  ]);

  return Response.json({
    overview: agent.overview,
    overviewUpdatedAt: agent.overviewUpdatedAt,
    files: nodeFiles,
    driveLinks: links.map((l) => ({ id: l.id, name: l.name, driveFolderId: l.driveFolderId, lastSyncedAt: l.lastSyncedAt })),
  });
}

// Edits the node's name, description and instructions. A rename also renames its Drive folder.
// Facts (from a prompt-driven edit) are saved as memories.
export async function PATCH(req: Request, ctx: RouteContext<"/api/agents/[id]">) {
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    name?: string;
    description?: string;
    systemPrompt?: string;
    facts?: string[];
  };
  if (body.name !== undefined && !body.name.trim()) {
    return new Response("Name can't be empty", { status: 400 });
  }
  const before = await getAgentById(id);
  if (!before) return new Response("Not found", { status: 404 });

  const updated = await updateNode(id, body);
  for (const fact of body.facts ?? []) {
    if (fact.trim()) await saveMemory({ content: fact.trim(), branch: updated.branch, source: `node-edit:${id}` });
  }
  let driveWarning: string | undefined;
  if (updated.name !== before.name) {
    await renameAgentFolder(id, updated.name).catch((err) => {
      driveWarning = `Renamed in the app, but not in Drive: ${err instanceof Error ? err.message : err}`;
    });
  }
  return Response.json({ ok: true, driveWarning });
}

// Removes the node and everything under it from the app. Files stay in Drive.
export async function DELETE(_req: Request, ctx: RouteContext<"/api/agents/[id]">) {
  const { id } = await ctx.params;
  const agent = await getAgentById(id);
  if (!agent) return new Response("Not found", { status: 404 });
  if (!agent.parentId) return new Response("The Brain can't be removed", { status: 400 });
  await db.delete(agents).where(eq(agents.id, id));
  return new Response(null, { status: 204 });
}
