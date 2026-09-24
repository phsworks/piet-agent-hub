import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, files } from "@/lib/db/schema";
import { listAgents } from "@/lib/agents/registry";
import { pathOf } from "@/lib/agents/create";
import { listMemories, searchMemories } from "@/lib/memory/store";
import { MODEL_NAME, CONTENT_LANGUAGE, PROJECT_SECTIONS, BRAIN_SLUG } from "@/lib/config";

const anthropic = new Anthropic();
const MAX_FILES = 60;
const FILES_PER_SECTION = 25;
// The Brain's profile is built from (almost) everything remembered about Piet.
const BRAIN_MEMORIES = 200;
const CHILD_OVERVIEW_CHARS = 600;

function fileLine(r: { name: string; createdAt: Date; summary: string | null }) {
  return `- ${r.name} (${r.createdAt.toISOString().slice(0, 10)})${r.summary ? `: ${r.summary}` : ""}`;
}

/**
 * Regenerates the summary shown when a node in the constellation is opened,
 * from its own files, its child nodes and what's remembered about Piet.
 * For the Brain this is a profile: who Piet is and where he stands now.
 */
export async function generateOverview(agentId: string) {
  const allAgents = await listAgents();
  const agent = allAgents.find((a) => a.id === agentId);
  if (!agent) throw new Error("Agent not found");
  const isBrain = agent.slug === BRAIN_SLUG;

  const rows = await db
    .select({ name: files.name, section: files.section, kind: files.kind, summary: files.summary, createdAt: files.createdAt })
    .from(files)
    .where(and(eq(files.agentId, agentId), eq(files.status, "ready")))
    .orderBy(desc(files.createdAt))
    .limit(200);

  const docs = rows.filter((r) => r.kind !== "code");
  let fileBlock: string;
  if (docs.length === 0) {
    fileBlock = "No files yet.";
  } else if (agent.kind === "project") {
    fileBlock = PROJECT_SECTIONS.map((s) => {
      const inSection = docs.filter((r) => (r.section ?? "other") === s.key).slice(0, FILES_PER_SECTION);
      return inSection.length ? `### ${s.label}\n${inSection.map(fileLine).join("\n")}` : null;
    })
      .filter(Boolean)
      .join("\n\n");
  } else {
    fileBlock = docs.slice(0, MAX_FILES).map(fileLine).join("\n");
  }

  const children = allAgents.filter((a) => a.parentId === agent.id);
  const childBlock = children
    .map((c) => {
      const overview = c.overview ? `\n  ${c.overview.slice(0, CHILD_OVERVIEW_CHARS).replace(/\n/g, "\n  ")}` : "";
      return `- ${c.name}: ${c.description}${overview}`;
    })
    .join("\n");

  const code = rows.find((r) => r.kind === "code");
  const memories = isBrain
    ? (await listMemories()).slice(0, BRAIN_MEMORIES)
    : await searchMemories(`${agent.name} ${agent.description}`, 10);

  const context = [
    `Node: ${agent.name}${agent.parentId ? ` (${pathOf(allAgents, agent)})` : ""}\nDescription: ${agent.description}`,
    `Files on this node:\n${fileBlock}`,
    code?.summary ? `Code snapshot overview:\n${code.summary}` : "",
    childBlock ? `Sub-nodes:\n${childBlock}` : "",
    memories.length ? `Things remembered about Piet:\n${memories.map((m) => `- ${m.content}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const today = new Date().toISOString().slice(0, 10);
  const format = `Write in ${CONTENT_LANGUAGE}. Use '## ' headings and '- ' bullets only, no other markdown. Skip a section when there is nothing to say. Don't invent facts. Today is ${today}.`;
  const system = isBrain
    ? `You write the profile shown on the central "Brain" node of Piet's personal knowledge base. Piet is an HBO-ICT student (HvA) who also works as an AI developer. Summarize who Piet is and where he stands right now. Sections: who he is; study (current semester, projects); work; side projects; what's going on now (deadlines, open items); preferences and goals. ${format}`
    : `You write the summary shown when Piet opens the "${agent.name}" node in his personal knowledge base. Piet is an HBO-ICT student (HvA) who also works as an AI developer. He reads this to see at a glance what's in this node and where things stand. Sections: what it is about; what's in the files (key facts, e.g. requirements, assessment criteria, dates, grades, feedback); sub-nodes (one line each, if any); current status; next steps and tips. ${format}`;

  const response = await anthropic.messages.create({
    model: MODEL_NAME,
    max_tokens: 3000,
    system,
    messages: [{ role: "user", content: context }],
  });

  const overview = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  await db
    .update(agents)
    .set({ overview, overviewUpdatedAt: new Date() })
    .where(eq(agents.id, agentId));
  return overview;
}
