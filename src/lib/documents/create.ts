import Anthropic from "@anthropic-ai/sdk";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";
import { CONTENT_LANGUAGE, DEEP_MODEL } from "@/lib/config";
import { dayKey } from "@/lib/dates";
import { createGoogleDoc, ensureRootSubfolder } from "@/lib/google/drive";
import { searchMemories } from "@/lib/memory/store";
import { searchFiles } from "@/lib/files/search";
import { findSchoolItem, updateSchoolItem } from "@/lib/school/roadmap";
import { itemForAssistant, schoolPicture } from "@/lib/school/priorities";

// Documents Piet asks for ("maak een plan van aanpak voor …"): one DEEP_MODEL
// call with what the hub knows (the roadmap item with its criteria, his own
// notes and files), saved as a Google Doc in /PietBrain/Gemaakt/<folder> so he
// can edit it and link it in Portflow.

const anthropic = new Anthropic();

export const DOCUMENT_FOLDERS = ["School", "Werk", "Overig"] as const;
export type DocumentFolder = (typeof DOCUMENT_FOLDERS)[number];
const ROOT = "Gemaakt";

// Enough of Piet's own material to ground the document without a huge prompt.
const MAX_PASSAGES = 6;
const PASSAGE_CHARS = 1200;
const MIN_NOTE_SIMILARITY = 0.3;

export const isDocumentFolder = (v: unknown): v is DocumentFolder => DOCUMENT_FOLDERS.includes(v as DocumentFolder);

async function gatherContext(request: string, itemQuery: string | null) {
  const [picture, notes, passages] = await Promise.all([
    itemQuery ? schoolPicture() : null,
    searchMemories(request, 5),
    searchFiles(request, { limit: MAX_PASSAGES }),
  ]);
  const found = itemQuery ? await findSchoolItem(itemQuery) : null;
  const item = found?.item ?? null;

  const parts = [
    item && picture ? `Roadmap item this is for (assignment, linked learning outcomes and their criteria):\n${JSON.stringify(itemForAssistant(item, picture), null, 1)}` : "",
    notes.filter((n) => n.similarity > MIN_NOTE_SIMILARITY).length
      ? `Piet's notes:\n${notes.filter((n) => n.similarity > MIN_NOTE_SIMILARITY).map((n) => `- ${n.content}`).join("\n")}`
      : "",
    passages.length ? `Passages from Piet's files:\n${passages.map((p) => `[${p.file}]\n${p.content.slice(0, PASSAGE_CHARS)}`).join("\n\n")}` : "",
  ].filter(Boolean);
  return { item, candidates: found?.candidates ?? [], context: parts.join("\n\n") };
}

export async function createDocument(opts: {
  request: string;
  title: string;
  folder: DocumentFolder;
  /** Title (or part) of a roadmap side quest/product the document is for. */
  item?: string | null;
  /** Facts the assistant already gathered (search results, Piet's answers). */
  extra?: string | null;
}) {
  const { item, candidates, context } = await gatherContext(opts.request, opts.item?.trim() || null);
  if (opts.item && !item) {
    return { error: `No single roadmap item matches "${opts.item}".`, candidates: candidates.map((c) => c.title) };
  }

  const response = await anthropic.messages.create({
    model: DEEP_MODEL,
    max_tokens: 8000,
    output_config: { effort: "low" },
    system: `You write documents for Piet, an HBO-ICT propedeuse student at the HvA who also works as an AI developer. Write in ${CONTENT_LANGUAGE}, in Markdown (headings, lists, tables where useful): a complete, usable first version, not an outline. When it's for a school assignment, follow the assignment's template and quality criteria and make each learning outcome's criteria visibly covered. Use the facts given; where something only Piet knows is needed (personal experience, team agreements, feedback he got), write [aanvullen: <what exactly>] instead of inventing it. Output only the document, starting with a # title.`,
    messages: [
      {
        role: "user",
        content: `Request: ${opts.request}\n\n${context || "(No matching notes, files or roadmap item found.)"}${opts.extra ? `\n\nMore context from the conversation:\n${opts.extra}` : ""}`,
      },
    ],
  });
  console.log(`[tokens] document in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);
  const markdown = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
    .replace(/^```(?:markdown)?\n([\s\S]*)\n```$/, "$1");
  if (!markdown) return { error: "The model returned no text." };

  const folderId = await ensureRootSubfolder(`${ROOT}/${opts.folder}`);
  const name = `${dayKey()} ${opts.title}`;
  // Markdown import gives real headings and tables; plain text is the fallback so the document is never lost.
  const file = await createGoogleDoc({ name, text: markdown, folderId, markdown: true }).catch((err) => {
    console.error("[documents] markdown import failed, saving as plain text", err);
    return createGoogleDoc({ name, text: markdown, folderId });
  });

  await db.insert(documents).values({
    title: opts.title,
    folder: opts.folder,
    request: opts.request,
    driveFileId: file.id,
    driveUrl: file.webViewLink,
    roadmapItemId: item?.id ?? null,
  });
  // Writing it is starting on it; never moves an item backwards.
  if (item && item.status === "todo") await updateSchoolItem(item.id, { status: "bezig" });

  return {
    title: opts.title,
    folder: `/PietBrain/${ROOT}/${opts.folder}`,
    link: file.webViewLink,
    roadmap_item: item ? item.title : null,
    to_fill_in: (markdown.match(/\[aanvullen:/g) ?? []).length,
    preview: markdown.slice(0, 600),
  };
}

export async function recentDocuments(limit = 10) {
  return db.select().from(documents).orderBy(desc(documents.createdAt)).limit(limit);
}
