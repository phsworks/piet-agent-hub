import { NextRequest } from "next/server";
import { enqueueUpload, type IngestResult } from "@/lib/files/ingest";
import { getGoogleStatus } from "@/lib/google/auth";
import { PROJECT_SECTIONS } from "@/lib/config";

export const dynamic = "force-dynamic";

// multipart/form-data: file (repeated), path (repeated, same order; "" if none),
// optional agentId and section. Without agentId the Brain decides where it goes.
export async function POST(req: NextRequest) {
  const google = await getGoogleStatus();
  if (!google.connected) {
    return new Response("Connect Google in Settings before uploading.", { status: 409 });
  }

  const form = await req.formData();
  const uploads = form.getAll("file").filter((f): f is File => f instanceof File);
  const paths = form.getAll("path").map(String);
  const agentId = (form.get("agentId") as string | null) || null;
  const sectionRaw = (form.get("section") as string | null) || null;
  const section = PROJECT_SECTIONS.some((s) => s.key === sectionRaw) ? sectionRaw : null;

  if (uploads.length === 0) return new Response("No files", { status: 400 });

  const total: IngestResult = { queued: 0, duplicates: 0, skipped: 0 };
  for (const [i, file] of uploads.entries()) {
    const result = await enqueueUpload({
      buffer: Buffer.from(await file.arrayBuffer()),
      name: file.name,
      path: paths[i] || null,
      mimeType: file.type,
      agentId,
      section,
    });
    total.queued += result.queued;
    total.duplicates += result.duplicates;
    total.skipped += result.skipped;
  }
  return Response.json(total);
}
