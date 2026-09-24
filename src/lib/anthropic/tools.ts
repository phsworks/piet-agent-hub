import type Anthropic from "@anthropic-ai/sdk";
import { searchMemories, saveMemory } from "@/lib/memory/store";
import { listAgents, subtreeIds, type Agent } from "@/lib/agents/registry";
import { searchFiles } from "@/lib/files/search";
import { extractText } from "@/lib/files/extract";
import {
  searchDrive,
  getDriveFile,
  downloadDriveFile,
  ensureAgentFolder,
  createGoogleDoc,
} from "@/lib/google/drive";
import { GoogleNotConnectedError } from "@/lib/google/auth";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { kickWorker } from "@/lib/files/worker";
import { BRAIN_SLUG, PROJECT_SECTIONS } from "@/lib/config";
import { createReminder, listReminders, DUE_DATE_PATTERN } from "@/lib/reminders/store";
import { listEvents } from "@/lib/calendar/feeds";
import { dayKey } from "@/lib/dates";

const DRIVE_READ_MAX_CHARS = 30_000;
// Agents that see every file by default instead of only their own subtree.
const GLOBAL_FILE_AGENTS = new Set([BRAIN_SLUG, "deadlines"]);

export const MEMORY_TOOLS: Anthropic.Tool[] = [
  {
    name: "memory_search",
    description:
      "Search Piet's long-term memory for durable facts relevant to a query (preferences, ongoing projects, courses, deadlines, past context). Use this before answering questions that could benefit from knowing more about Piet.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to search for in memory.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_save",
    description:
      "Save or update a durable fact about Piet in long-term memory. Only use this for information worth remembering across future conversations (preferences, ongoing projects, deadlines, recurring context) — not small talk or one-off details.",
    input_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The fact to remember, written as a standalone statement.",
        },
        category: {
          type: "string",
          description: "e.g. 'preference', 'fact', 'goal', 'project'.",
        },
        branch: {
          type: "string",
          description: "e.g. 'school', 'work', 'projects', 'general'.",
        },
      },
      required: ["content"],
    },
  },
];

export const FILE_TOOLS: Anthropic.Tool[] = [
  {
    name: "files_search",
    description:
      "Semantic search in the contents of files Piet uploaded or indexed (school documents, feedback, notes, project code). Returns matching passages with file name, section and Drive link. By default searches your own files (yours and your sub-agents'); use scope 'all' to search everything.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, phrased like the content you expect." },
        scope: { type: "string", enum: ["own", "all"] },
      },
      required: ["query"],
    },
  },
  {
    name: "drive_search",
    description:
      "Search all of Piet's Google Drive by file name and full text. Use this for files that may not be indexed in the app yet. Returns file ids and links; use drive_read to read one.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to search for." },
      },
      required: ["query"],
    },
  },
  {
    name: "drive_read",
    description: "Read the text of a Google Drive file by id (from drive_search or files_search).",
    input_schema: {
      type: "object",
      properties: { file_id: { type: "string" } },
      required: ["file_id"],
    },
  },
  {
    name: "drive_upload",
    description:
      "Save a text document (notes, a plan, a summary) as a Google Doc in your folder in Piet's Drive (/PietBrain/...). Only do this when Piet asks you to save or write something down.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Document title." },
        content: { type: "string", description: "Plain-text content." },
        section: {
          type: "string",
          enum: PROJECT_SECTIONS.map((s) => s.key),
          description: "Project section (only for project agents; default notes).",
        },
      },
      required: ["name", "content"],
    },
  },
];

// Every agent gets these, regardless of allowed_tools: any agent may suggest a
// reminder, and Piet accepts or dismisses it in the Reminders card.
export const REMINDER_TOOLS: Anthropic.Tool[] = [
  {
    name: "reminder_propose",
    description:
      "Suggest a reminder or deadline for Piet. It appears in his Reminders list as a suggestion he can accept or dismiss, so only propose things he'd clearly want to remember (a deadline mentioned in a file or conversation, a follow-up he agreed to). Check reminder_list first to avoid duplicates.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short, actionable, in Dutch (e.g. 'Reflectieverslag inleveren')." },
        due_date: { type: "string", description: "YYYY-MM-DD, if there is a date. Makes it a deadline." },
        notes: { type: "string", description: "Optional extra context." },
        node_slug: {
          type: "string",
          description: "Slug of the node it belongs to. Defaults to you.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "reminder_list",
    description: "List Piet's open reminders and deadlines (and pending suggestions), with dates and the node they belong to.",
    input_schema: { type: "object", properties: {} },
  },
];

export const CALENDAR_TOOLS: Anthropic.Tool[] = [
  {
    name: "calendar_list_events",
    description: "List events from Piet's school schedule and other calendar feeds for the coming days.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days ahead, from now (default 7, max 60)." },
      },
    },
  },
];

const ALL_TOOLS = [...MEMORY_TOOLS, ...FILE_TOOLS, ...CALENDAR_TOOLS];

export const DELEGATE_TOOL_NAME = "delegate_to_agent";

// Built per request so the enum and descriptions always match the agents table.
function buildDelegateTool(candidates: Agent[]): Anthropic.Tool {
  const list = candidates
    .map((a) => `- ${a.slug} (${a.name}): ${a.description}`)
    .join("\n");
  return {
    name: DELEGATE_TOOL_NAME,
    description: `Hand the current message off to a specialist agent, who will answer Piet directly. Use when the message clearly belongs to one of these agents:\n${list}`,
    input_schema: {
      type: "object",
      properties: {
        agent_slug: {
          type: "string",
          enum: candidates.map((a) => a.slug),
          description: "Which agent to hand off to.",
        },
        note: {
          type: "string",
          description:
            "Short note for the specialist: what Piet wants and any context you already know.",
        },
      },
      required: ["agent_slug"],
    },
  };
}

/**
 * Tool definitions an agent may use: its allowed_tools, minus anything not
 * implemented yet. Delegation targets are every agent except the caller.
 */
export function toolsForAgent(
  agent: Agent,
  allAgents: Agent[],
  opts: { allowDelegation: boolean }
): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [];
  for (const name of agent.allowedTools) {
    if (name === DELEGATE_TOOL_NAME) {
      const candidates = allAgents.filter((a) => a.id !== agent.id);
      if (opts.allowDelegation && candidates.length > 0) {
        tools.push(buildDelegateTool(candidates));
      }
      continue;
    }
    const tool = ALL_TOOLS.find((t) => t.name === name);
    if (tool) tools.push(tool);
  }
  return [...tools, ...REMINDER_TOOLS];
}

export type ToolContext = { source?: string; agent?: Agent };

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext = {}
): Promise<unknown> {
  try {
    return await runTool(name, input, ctx);
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) {
      return { error: "Google Drive isn't connected yet. Tell Piet to connect it in Settings." };
    }
    console.error(`Tool ${name} failed`, err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext) {
  switch (name) {
    case "memory_search": {
      const results = await searchMemories(input.query as string);
      return { results };
    }
    case "memory_save": {
      const result = await saveMemory({
        content: input.content as string,
        category: input.category as string | undefined,
        branch: input.branch as string | undefined,
        source: ctx.source,
      });
      return result;
    }
    case "files_search": {
      const global = !ctx.agent || GLOBAL_FILE_AGENTS.has(ctx.agent.slug) || input.scope === "all";
      const agentIds = global ? undefined : subtreeIds(await listAgents(), ctx.agent!.id);
      const results = await searchFiles(input.query as string, { agentIds });
      return {
        results: results.map((r) => ({ ...r, similarity: Number(r.similarity.toFixed(3)) })),
      };
    }
    case "drive_search": {
      const results = await searchDrive(input.query as string);
      return { results };
    }
    case "drive_read": {
      const meta = await getDriveFile(input.file_id as string);
      const download = await downloadDriveFile(meta);
      const text = download ? await extractText(download.buffer, download.name) : null;
      if (!text) return { name: meta.name, link: meta.webViewLink, text: null, note: "No readable text in this file." };
      return {
        name: meta.name,
        link: meta.webViewLink,
        text: text.slice(0, DRIVE_READ_MAX_CHARS),
        truncated: text.length > DRIVE_READ_MAX_CHARS,
      };
    }
    case "drive_upload": {
      const agent = ctx.agent;
      if (!agent) return { error: "No agent context" };
      const section = agent.kind === "project" ? ((input.section as string) ?? "notes") : null;
      const folderId = await ensureAgentFolder(agent.id, section);
      const doc = await createGoogleDoc({
        name: input.name as string,
        text: input.content as string,
        folderId,
      });
      // Index it like any other Drive file so it shows up in search and the dashboard.
      await db.insert(files).values({
        kind: "drive",
        agentId: agent.id,
        section,
        name: doc.name,
        mimeType: doc.mimeType,
        driveFileId: doc.id,
        driveUrl: doc.webViewLink,
        driveModifiedAt: doc.modifiedTime ? new Date(doc.modifiedTime) : null,
      });
      kickWorker();
      return { saved: true, name: doc.name, link: doc.webViewLink };
    }
    case "reminder_propose": {
      const dueDate = input.due_date as string | undefined;
      if (dueDate && !DUE_DATE_PATTERN.test(dueDate)) return { error: "due_date must be YYYY-MM-DD" };
      let agentId = ctx.agent?.id ?? null;
      if (input.node_slug) {
        const node = (await listAgents()).find((a) => a.slug === input.node_slug);
        if (!node) return { error: `No node with slug ${input.node_slug}` };
        agentId = node.id;
      }
      const row = await createReminder({
        title: input.title as string,
        notes: input.notes as string | undefined,
        dueDate,
        agentId,
        status: "proposed",
        proposedBy: ctx.agent?.name ?? null,
      });
      return { proposed: true, id: row.id, note: "Piet sees it as a suggestion in his Reminders list." };
    }
    case "reminder_list": {
      const today = dayKey();
      const rows = await listReminders();
      return {
        today,
        reminders: rows.map((r) => ({
          title: r.title,
          due_date: r.dueDate,
          overdue: Boolean(r.dueDate && r.dueDate < today),
          node: r.agentName,
          status: r.status === "proposed" ? "suggested, not accepted yet" : "open",
          notes: r.notes,
        })),
      };
    }
    case "calendar_list_events": {
      const days = Math.min(Math.max(Number(input.days) || 7, 1), 60);
      const now = new Date();
      const events = await listEvents(now, new Date(now.getTime() + days * 86_400_000));
      return { events };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
