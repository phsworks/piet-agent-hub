import Anthropic from "@anthropic-ai/sdk";
import { parseOffice, type SupportedFileType } from "officeparser";
import { FAST_MODEL_NAME, CONTENT_LANGUAGE } from "@/lib/config";
import { extensionOf, TEXT_EXTENSIONS } from "./file-types";

const anthropic = new Anthropic();

// Longer documents are cut off; enough for summaries and search.
const MAX_TEXT_CHARS = 400_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const OFFICE_TYPES = new Set(["pdf", "docx", "pptx", "xlsx", "odt", "odp", "ods", "rtf", "epub", "html", "htm"]);
const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
export async function extractText(buffer: Buffer, name: string): Promise<string | null> {
  const ext = extensionOf(name);
  let text: string | null = null;

  if (TEXT_EXTENSIONS.has(ext)) {
    text = buffer.toString("utf8");
  } else if (OFFICE_TYPES.has(ext)) {
    const fileType = (ext === "htm" ? "html" : ext) as SupportedFileType;
    const ast = await parseOffice(buffer, { fileType });
    const { value } = await ast.to("text", {
      includeImages: false,
      textConfig: { preserveLayout: false, renderNotes: true },
    });
    text = value;
  } else if (IMAGE_TYPES[ext] && buffer.length <= MAX_IMAGE_BYTES) {
    text = await describeImage(buffer, IMAGE_TYPES[ext], name);
  }

  text = text?.replace(/\u0000/g, "").trim() ?? null;
  if (!text) return null;
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

async function describeImage(
  buffer: Buffer,
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp",
  name: string
) {
  const response = await anthropic.messages.create({
    model: FAST_MODEL_NAME,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } },
          {
            type: "text",
            text: `This image ("${name}") was uploaded by a student to his personal knowledge base. Transcribe any readable text, then describe what the image shows so it can be found by search later. Write in ${CONTENT_LANGUAGE}.`,
          },
        ],
      },
    ],
  });
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
