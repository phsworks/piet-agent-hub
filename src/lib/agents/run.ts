import Anthropic from "@anthropic-ai/sdk";
import { executeTool, DELEGATE_TOOL_NAME } from "@/lib/anthropic/tools";
import { AGENT_BASE_PROMPT, MODEL_NAME } from "@/lib/config";
import type { Agent } from "./registry";

const anthropic = new Anthropic();
const MAX_TOKENS = 2048;
const MAX_TOOL_ROUNDS = 10;

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "agent"; slug: string; name: string };

export type Delegation = { agentSlug: string; note?: string };

export function systemPromptFor(agent: Agent, handoffNote?: string) {
  let prompt = `${AGENT_BASE_PROMPT}\n\n${agent.systemPrompt}`;
  if (agent.overview) {
    prompt += `\n\nCurrent overview of this node (generated from its files and sub-nodes):\n${agent.overview}`;
  }
  if (handoffNote !== undefined) {
    prompt += `\n\nThe Brain handed this message to you. Answer Piet directly.${
      handoffNote ? ` Brain's note: ${handoffNote}` : ""
    }`;
  }
  return prompt;
}

/**
 * Runs one agent's tool-use loop, streaming text through `emit`.
 * Stops early and returns the delegation if the agent calls delegate_to_agent.
 */
export async function runAgent(opts: {
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  emit: (event: AgentEvent) => void;
  source: string;
  agent: Agent;
}): Promise<{ text: string; delegation?: Delegation }> {
  const messages = [...opts.messages];
  let text = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const messageStream = anthropic.messages.stream({
      model: MODEL_NAME,
      max_tokens: MAX_TOKENS,
      system: opts.system,
      tools: opts.tools.length > 0 ? opts.tools : undefined,
      messages,
    });

    messageStream.on("text", (delta) => {
      text += delta;
      opts.emit({ type: "text", text: delta });
    });

    const final = await messageStream.finalMessage();
    messages.push({ role: "assistant", content: final.content });

    if (final.stop_reason !== "tool_use") {
      return { text };
    }

    const toolUses = final.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    const delegate = toolUses.find((b) => b.name === DELEGATE_TOOL_NAME);
    if (delegate) {
      const input = delegate.input as { agent_slug: string; note?: string };
      return { text, delegation: { agentSlug: input.agent_slug, note: input.note } };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUses) {
      opts.emit({ type: "tool", name: block.name });
      const result = await executeTool(
        block.name,
        block.input as Record<string, unknown>,
        { source: opts.source, agent: opts.agent }
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { text };
}
