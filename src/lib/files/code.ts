import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { getAgentById } from "@/lib/agents/registry";
import { saveMemory } from "@/lib/memory/store";
import { MODEL_NAME, CONTENT_LANGUAGE } from "@/lib/config";
import { replaceChunks } from "./worker";
import type { CodeSnapshot } from "./ingest";

const anthropic = new Anthropic();

const CHUNK_CHARS = 900;
const TREE_MAX_LINES = 400;
const KEY_FILES_MAX_CHARS = 60_000;

// Files that say the most about a project, in priority order.
const KEY_FILE_PATTERNS = [
  /^readme(\.md)?$/i,
  /^(package\.json|pyproject\.toml|requirements\.txt|cargo\.toml|go\.mod|pom\.xml|build\.gradle(\.kts)?|composer\.json|pubspec\.yaml)$/i,
  /^(docker-compose\.ya?ml|dockerfile)$/i,
  /(^|\/)(claude|agents)\.md$/i,
  /(^|\/)schema\.(ts|prisma|sql|py)$/i,
  /^(src\/)?(app\/)?(page|layout|main|index|app)\.(tsx?|jsx?|py)$/i,
  /(^|\/)(routes?|models?|api)\.(ts|py|js)$/i,
];

function chunkCode(path: string, content: string) {
  const lines = content.split("\n");
  const chunks: { path: string; content: string }[] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of lines) {
    if (size + line.length > CHUNK_CHARS && current.length > 0) {
      chunks.push({ path, content: current.join("\n") });
      current = [];
      size = 0;
    }
    current.push(line.slice(0, CHUNK_CHARS));
    size += line.length + 1;
  }
  if (current.join("").trim()) chunks.push({ path, content: current.join("\n") });
  return chunks;
}

function pickKeyFiles(entries: CodeSnapshot["entries"]) {
  const picked: string[] = [];
  let total = 0;
  for (const pattern of KEY_FILE_PATTERNS) {
    for (const e of entries) {
      if (!pattern.test(e.path) || picked.some((p) => p.startsWith(`--- ${e.path}\n`))) continue;
      const block = `--- ${e.path}\n${e.content.slice(0, 15_000)}`;
      if (total + block.length > KEY_FILES_MAX_CHARS) return picked;
      picked.push(block);
      total += block.length;
    }
  }
  return picked;
}

export async function processCodeSnapshot(file: typeof files.$inferSelect) {
  if (!file.tempPath) throw new Error("Code snapshot data is gone. Upload the folder again.");
  const snapshot = JSON.parse(await readFile(file.tempPath, "utf8")) as CodeSnapshot;
  const agent = file.agentId ? await getAgentById(file.agentId) : undefined;
  if (!agent) throw new Error("Project not found");

  const chunks = snapshot.entries.flatMap((e) => chunkCode(e.path, e.content));
  await replaceChunks(file.id, chunks, file.name);

  const tree = snapshot.entries
    .map((e) => e.path)
    .sort()
    .slice(0, TREE_MAX_LINES)
    .join("\n");

  const response = await anthropic.messages.create({
    model: MODEL_NAME,
    max_tokens: 4096,
    system: `You review a snapshot of the code for Piet's project "${agent.name}" (${agent.description}). Piet uploads it so his assistant understands where the project stands; he will ask questions and want insight and tips, not code generation. Write in ${CONTENT_LANGUAGE}.`,
    tools: [
      {
        name: "record_code_overview",
        description: "Record the overview of this codebase.",
        input_schema: {
          type: "object",
          properties: {
            overview: {
              type: "string",
              description:
                "Plain-text overview (max ~350 words) with short sections: stack, structure (main parts and where they live), what is built so far, what looks unfinished or risky (TODOs, missing tests, rough edges). Use '## ' headings and '- ' bullets, no other markdown.",
            },
            memory_fact: {
              type: "string",
              description: "One standalone sentence worth remembering long-term, e.g. 'Project X is a Next.js + Postgres app for ...; auth and payments are not built yet.'",
            },
          },
          required: ["overview", "memory_fact"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "record_code_overview" },
    messages: [
      {
        role: "user",
        content: `Files (${snapshot.entries.length}):\n${tree}\n\nKey files:\n${pickKeyFiles(snapshot.entries).join("\n\n")}`,
      },
    ],
  });

  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (block?.input ?? {}) as { overview?: string; memory_fact?: string };
  if (!input.overview) {
    throw new Error(`Code overview came back empty (stop reason: ${response.stop_reason}). Retry the upload.`);
  }

  await db
    .update(files)
    .set({ status: "ready", summary: input.overview ?? null, tempPath: null, processedAt: new Date() })
    .where(eq(files.id, file.id));

  // The new snapshot replaces older ones.
  await db
    .delete(files)
    .where(and(eq(files.agentId, agent.id), eq(files.kind, "code"), ne(files.id, file.id)));

  if (input.memory_fact) {
    await saveMemory({
      content: input.memory_fact,
      category: "project",
      branch: agent.branch,
      source: `code:${agent.slug}`,
    });
  }
}
