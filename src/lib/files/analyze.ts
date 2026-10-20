import Anthropic from "@anthropic-ai/sdk";
import { FAST_MODEL_NAME, CONTENT_LANGUAGE, PROJECT_SECTIONS, BRAIN_SLUG } from "@/lib/config";
import type { Agent } from "@/lib/agents/registry";

const anthropic = new Anthropic();

// The model sees the start of the document; enough to place and summarize it.
const EXCERPT_CHARS = 12_000;

export type FileAnalysis = { agentId: string; section: string | null; summary: string | null };

/**
 * One cheap call that both places a file (which agent, which project section)
 * and summarizes it. `fixedAgent` skips agent choice (dropped on a specific agent).
 * `fixedSection` skips section choice too.
 */
export async function analyzeFile(opts: {
  name: string;
  path: string | null;
  text: string | null;
  /** Piet's own words with the upload (e.g. a Telegram caption). */
  note?: string | null;
  allAgents: Agent[];
  fixedAgent?: Agent;
  fixedSection?: string | null;
}): Promise<FileAnalysis> {
  const { allAgents, fixedAgent } = opts;
  const brain = allAgents.find((a) => a.slug === BRAIN_SLUG)!;
  const needsAgent = !fixedAgent;
  // Section is only asked when the target is (or may be) a project.
  const mayBeProject = needsAgent ? allAgents.some((a) => a.kind === "project") : fixedAgent.kind === "project";
  const needsSection = mayBeProject && !opts.fixedSection;

  if (!opts.text && !opts.note && !needsAgent && !needsSection) {
    return { agentId: fixedAgent!.id, section: opts.fixedSection ?? null, summary: null };
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  if (needsAgent) {
    properties.agent_slug = {
      type: "string",
      enum: allAgents.map((a) => a.slug),
      description: `Which agent this file belongs to. Use "${BRAIN_SLUG}" only if it fits nowhere else.`,
    };
    required.push("agent_slug");
  }
  if (needsSection) {
    properties.section = {
      type: "string",
      enum: PROJECT_SECTIONS.map((s) => s.key),
      description: "Project section (only used when the agent is a project).",
    };
    required.push("section");
  }
  if (opts.text) {
    properties.summary = {
      type: "string",
      description: `2-4 sentence summary in ${CONTENT_LANGUAGE}: what the document is and the key points Piet may ask about later (dates, requirements, grades, decisions).`,
    };
    required.push("summary");
  }

  const agentList = allAgents
    .map((a) => {
      const parent = allAgents.find((p) => p.id === a.parentId);
      return `- ${a.slug} (${a.name}${a.kind === "project" ? ", project" : ""}${parent ? `, under ${parent.name}` : ""}): ${a.description}`;
    })
    .join("\n");
  const sectionList = PROJECT_SECTIONS.map((s) => `- ${s.key}: ${s.hint}`).join("\n");

  const system = [
    "You file documents into Piet's personal knowledge base. Piet is an HBO-ICT student (HvA) who also works as an AI developer and has side projects.",
    needsAgent ? `Agents:\n${agentList}\nPrefer the most specific agent (a project over its semester, a semester over School).` : `This file belongs to "${fixedAgent!.name}".`,
    needsSection ? `Project sections:\n${sectionList}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const excerpt = opts.text ? opts.text.slice(0, EXCERPT_CHARS) : "(no readable text)";
  const response = await anthropic.messages.create({
    model: FAST_MODEL_NAME,
    max_tokens: 600,
    system,
    tools: [
      {
        name: "file_document",
        description: "Record where the document belongs and what it contains.",
        input_schema: { type: "object", properties, required },
      },
    ],
    tool_choice: { type: "tool", name: "file_document" },
    messages: [
      {
        role: "user",
        content: `File name: ${opts.name}${opts.path ? `\nPath in upload: ${opts.path}` : ""}${opts.note ? `\nPiet's note: ${opts.note}` : ""}\n\nContent:\n${excerpt}`,
      },
    ],
  });

  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (block?.input ?? {}) as { agent_slug?: string; section?: string; summary?: string };

  const agent = fixedAgent ?? allAgents.find((a) => a.slug === input.agent_slug) ?? brain;
  const section =
    agent.kind === "project" ? (opts.fixedSection ?? input.section ?? "other") : null;
  return { agentId: agent.id, section, summary: input.summary?.trim() || null };
}
