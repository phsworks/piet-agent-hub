import Anthropic from "@anthropic-ai/sdk";
import { MEMORY_TOOLS, executeTool } from "@/lib/anthropic/tools";
import { MODEL_NAME } from "@/lib/config";

const anthropic = new Anthropic();

const EXTRACTION_PROMPT = `Review this exchange between Piet and his assistant. If it contains a new durable fact about Piet worth remembering long-term (a preference, an ongoing project, a deadline, a course, a goal, recurring context), call memory_save once per fact. If there is nothing worth remembering, do not call any tool.`;

const memorySaveTool = MEMORY_TOOLS.find((t) => t.name === "memory_save")!;

export async function extractMemories(
  userMessage: string,
  assistantMessage: string,
  conversationId: string
) {
  const response = await anthropic.messages.create({
    model: MODEL_NAME,
    max_tokens: 512,
    system: EXTRACTION_PROMPT,
    tools: [memorySaveTool],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: `User: ${userMessage}\n\nAssistant: ${assistantMessage}`,
      },
    ],
  });

  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "memory_save") {
      await executeTool(
        "memory_save",
        block.input as Record<string, unknown>,
        { source: conversationId }
      );
    }
  }
}
