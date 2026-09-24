import { NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { conversations, messages } from "@/lib/db/schema";
import { toolsForAgent } from "@/lib/anthropic/tools";
import { extractMemories } from "@/lib/memory/extract";
import { listAgents, type Agent } from "@/lib/agents/registry";
import { runAgent, systemPromptFor, type AgentEvent } from "@/lib/agents/run";
import { BRAIN_SLUG } from "@/lib/config";

export const dynamic = "force-dynamic";

// Response body is NDJSON: one AgentEvent (or {type:"error"}) per line.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    conversationId?: string;
    agentId?: string;
    message?: string;
  };
  const userMessage = body.message;

  if (!userMessage || typeof userMessage !== "string") {
    return new Response("Missing message", { status: 400 });
  }

  const allAgents = await listAgents();
  const brain = allAgents.find((a) => a.slug === BRAIN_SLUG);
  if (!brain) {
    return new Response("No Brain agent found. Run `npm run db:seed`.", {
      status: 500,
    });
  }

  let conversationId = body.conversationId;
  let agent: Agent | undefined;

  if (conversationId) {
    const [conv] = await db
      .select({ agentId: conversations.agentId })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!conv) return new Response("Conversation not found", { status: 404 });
    agent = allAgents.find((a) => a.id === conv.agentId) ?? brain;
  } else {
    agent = body.agentId
      ? allAgents.find((a) => a.id === body.agentId)
      : brain;
    if (!agent) return new Response("Agent not found", { status: 404 });

    const [created] = await db
      .insert(conversations)
      .values({ agentId: agent.id, title: userMessage.slice(0, 60) })
      .returning({ id: conversations.id });
    conversationId = created.id;
  }

  await db.insert(messages).values({
    conversationId,
    role: "user",
    content: userMessage,
  });

  const history = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  const anthropicMessages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const encoder = new TextEncoder();
  const finalConversationId = conversationId;
  const startAgent = agent;

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AgentEvent | { type: "error"; message: string }) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        // Only the Brain delegates, and only one level deep.
        const isBrain = startAgent.slug === BRAIN_SLUG;
        const result = await runAgent({
          system: systemPromptFor(startAgent),
          tools: toolsForAgent(startAgent, allAgents, { allowDelegation: isBrain }),
          messages: anthropicMessages,
          emit,
          source: finalConversationId,
          agent: startAgent,
        });

        let finalText = result.text;
        let answeredBy = startAgent;

        const target =
          result.delegation &&
          allAgents.find((a) => a.slug === result.delegation!.agentSlug);

        if (target) {
          emit({ type: "agent", slug: target.slug, name: target.name });
          const handoff = await runAgent({
            system: systemPromptFor(target, result.delegation!.note ?? ""),
            tools: toolsForAgent(target, allAgents, { allowDelegation: false }),
            messages: anthropicMessages,
            emit,
            source: finalConversationId,
            agent: target,
          });
          finalText = [finalText.trim(), handoff.text].filter(Boolean).join("\n\n");
          answeredBy = target;
        }

        await db.insert(messages).values({
          conversationId: finalConversationId,
          role: "assistant",
          agentId: answeredBy.id,
          content: finalText,
        });

        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, finalConversationId));

        extractMemories(userMessage, finalText, finalConversationId).catch(
          (err) => console.error("Memory extraction failed", err)
        );
      } catch (err) {
        console.error(err);
        emit({ type: "error", message: "Something went wrong. Check server logs." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Conversation-Id": finalConversationId,
    },
  });
}
