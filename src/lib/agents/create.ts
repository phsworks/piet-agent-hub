import { eq, max } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, conversations, driveLinks, files } from "@/lib/db/schema";
import { getAgentById, getAgentBySlug, listAgents, subtreeIds, type Agent } from "@/lib/agents/registry";
import { PROJECT_SECTIONS } from "@/lib/config";

export const NODE_TOOLS = [
  "memory_search",
  "memory_save",
  "files_search",
  "drive_search",
  "drive_read",
  "drive_upload",
  "school_get_deadlines",
];

function slugify(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "node"
  );
}

/** "School › Semester 3" — where a node sits, for prompts. */
export function pathOf(allAgents: Agent[], agent: Agent) {
  const names: string[] = [];
  for (let a: Agent | undefined = agent; a && a.parentId; a = allAgents.find((p) => p.id === a!.parentId)) {
    names.unshift(a.name);
  }
  return names.join(" › ");
}

function nodeSystemPrompt(opts: { name: string; path: string; description: string; isProject: boolean }) {
  const base = `You are the agent for "${opts.name}" in Piet's Brain (${opts.path}). ${opts.description}

Piet uploads files to you and to the nodes below you. Use files_search to look things up in them before answering, and name the files you rely on. Piet mostly wants insight, honest feedback and practical tips.`;
  if (!opts.isProject) return base;
  const sections = PROJECT_SECTIONS.map((s) => s.label).join(", ");
  return `${base}

This is a project. Its files are split into sections (${sections}) plus a code snapshot. Know it inside out: where it stands, what's missing against the requirements and assessment criteria, what to do next. Point out risks early.`;
}

export async function createNode(input: {
  name: string;
  parentId: string;
  description?: string;
  isProject?: boolean;
}) {
  const parent = await getAgentById(input.parentId);
  if (!parent) throw new Error("Parent not found");

  const name = input.name.trim();
  const isProject = input.isProject ?? false;
  const description = input.description?.trim() || `${name} (${parent.name}).`;

  const base = slugify(name);
  let slug = base;
  for (let i = 2; await getAgentBySlug(slug); i++) slug = `${base}-${i}`;

  const [{ position }] = await db
    .select({ position: max(agents.position) })
    .from(agents)
    .where(eq(agents.parentId, parent.id));

  const allAgents = await listAgents();
  const path = [pathOf(allAgents, parent), name].filter(Boolean).join(" › ");

  const [created] = await db
    .insert(agents)
    .values({
      slug,
      parentId: parent.id,
      name,
      branch: parent.branch,
      kind: isProject ? "project" : "agent",
      description,
      systemPrompt: nodeSystemPrompt({ name, path, description, isProject }),
      allowedTools: NODE_TOOLS,
      icon: isProject ? "folder-kanban" : "circle-dot",
      position: (position ?? -1) + 1,
    })
    .returning();
  return created;
}

/**
 * Edits a node's name, description and/or instructions. Generated instructions
 * (of this node and the nodes below it, which mention its path) follow a rename;
 * instructions Piet wrote himself are left alone.
 */
export async function updateNode(
  id: string,
  input: { name?: string; description?: string; systemPrompt?: string }
) {
  const allAgents = await listAgents();
  const agent = allAgents.find((a) => a.id === id);
  if (!agent) throw new Error("Node not found");

  const name = input.name?.trim() || agent.name;
  const description = input.description?.trim() || agent.description;
  const promptOf = (a: Agent, list: Agent[]) =>
    nodeSystemPrompt({ name: a.name, path: pathOf(list, a), description: a.description, isProject: a.kind === "project" });

  const edited = { ...agent, name, description };
  const after = allAgents.map((a) => (a.id === id ? edited : a));

  const promptChanged = input.systemPrompt !== undefined && input.systemPrompt.trim() !== agent.systemPrompt;
  const systemPrompt = promptChanged
    ? input.systemPrompt!.trim()
    : agent.systemPrompt === promptOf(agent, allAgents)
      ? promptOf(edited, after)
      : agent.systemPrompt;

  const now = new Date();
  await db.update(agents).set({ name, description, systemPrompt, updatedAt: now }).where(eq(agents.id, id));

  if (name !== agent.name) {
    for (const childId of subtreeIds(allAgents, id).slice(1)) {
      const child = allAgents.find((a) => a.id === childId)!;
      if (child.systemPrompt !== promptOf(child, allAgents)) continue;
      await db
        .update(agents)
        .set({ systemPrompt: promptOf(child, after), updatedAt: now })
        .where(eq(agents.id, childId));
    }
  }
  return { ...edited, systemPrompt };
}

export type ResetParts = { chats?: boolean; summary?: boolean; files?: boolean };

/** Clears parts of a single node (not its sub-nodes). Files stay in Drive. */
export async function resetNode(id: string, parts: ResetParts) {
  if (parts.chats) {
    await db.delete(conversations).where(eq(conversations.agentId, id));
  }
  if (parts.files) {
    // Linked-folder files cascade with their link; uploads and code go separately.
    await db.delete(driveLinks).where(eq(driveLinks.agentId, id));
    await db.delete(files).where(eq(files.agentId, id));
  }
  if (parts.summary) {
    await db.update(agents).set({ overview: null, overviewUpdatedAt: null }).where(eq(agents.id, id));
  }
}
