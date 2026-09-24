import Anthropic from "@anthropic-ai/sdk";
import { listAgents } from "@/lib/agents/registry";
import { pathOf } from "@/lib/agents/create";
import { MODEL_NAME } from "@/lib/config";

const anthropic = new Anthropic();

export type NodeProposal = {
  name: string;
  description: string;
  systemPrompt: string;
  /** Durable facts about Piet in the request, to save as memories. */
  facts: string[];
};

/**
 * Turns Piet's plain-language request ("also cover my job at StudentAanHuis")
 * into a new name, description and instructions for a node. Nothing is saved:
 * Piet reviews the proposal in the edit dialog first.
 */
export async function proposeNodeEdit(agentId: string, request: string): Promise<NodeProposal> {
  const allAgents = await listAgents();
  const agent = allAgents.find((a) => a.id === agentId);
  if (!agent) throw new Error("Node not found");

  const children = allAgents.filter((a) => a.parentId === agent.id);
  const context = [
    `Node: ${agent.name}${agent.parentId ? ` (${pathOf(allAgents, agent)})` : " (the root Brain)"}`,
    `Current description:\n${agent.description}`,
    `Current instructions:\n${agent.systemPrompt}`,
    children.length ? `Sub-nodes:\n${children.map((c) => `- ${c.name}: ${c.description}`).join("\n")}` : "",
    `Piet's requested change:\n${request.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: MODEL_NAME,
    max_tokens: 2000,
    system: `You edit one node (agent) in Piet's Brain, Piet's personal multi-agent assistant. Piet is an HBO-ICT student (HvA) who also works as an AI developer. Each node has a short description (the Brain uses it to route questions and files) and instructions (its system prompt). Apply Piet's requested change and return the full updated node.
- Keep what still applies; change only what the request asks for. Keep the name unless Piet asks to rename it.
- The description is one or two sentences and must mention everything the node now covers, so routing works.
- Write the instructions in English, in the same style as the current ones, addressed to the agent ("You are…").
- In facts, list durable facts about Piet stated in the request (e.g. "Piet works at StudentAanHuis, helping elderly people with their computers at home"), in English. Leave it empty if there are none.`,
    tools: [
      {
        name: "update_node",
        description: "Return the updated node.",
        input_schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            system_prompt: { type: "string" },
            facts: { type: "array", items: { type: "string" } },
          },
          required: ["name", "description", "system_prompt", "facts"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "update_node" },
    messages: [{ role: "user", content: context }],
  });

  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (block?.input ?? {}) as { name?: string; description?: string; system_prompt?: string; facts?: string[] };
  return {
    name: input.name?.trim() || agent.name,
    description: input.description?.trim() || agent.description,
    systemPrompt: input.system_prompt?.trim() || agent.systemPrompt,
    facts: (input.facts ?? []).map((f) => f.trim()).filter(Boolean),
  };
}
