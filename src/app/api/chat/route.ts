import { NextRequest } from "next/server";
import { runAssistant } from "@/lib/assistant/run";
import { addMessage, conversationExists, createConversation, recentHistory } from "@/lib/assistant/conversation";

export const dynamic = "force-dynamic";

// Response body is NDJSON: {type:"tool"} while tools run, then one {type:"text"}
// with the whole answer (or {type:"error"}).
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { conversationId?: string; message?: string; deep?: boolean };
  const userMessage = body.message?.trim();
  if (!userMessage) return new Response("Missing message", { status: 400 });

  let conversationId = body.conversationId;
  if (conversationId && !(await conversationExists(conversationId))) {
    return new Response("Conversation not found", { status: 404 });
  }
  conversationId ??= await createConversation(userMessage);

  await addMessage(conversationId, "user", userMessage);
  const history = await recentHistory(conversationId);
  const id = conversationId;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        const result = await runAssistant({
          messages: history,
          deep: body.deep,
          source: id,
          onEvent: emit,
        });
        await addMessage(id, "assistant", result.text);
        emit({ type: "text", text: result.text });
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
      "X-Conversation-Id": id,
    },
  });
}
