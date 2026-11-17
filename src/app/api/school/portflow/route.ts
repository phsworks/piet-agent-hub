import { importEvidence, readScreenshot } from "@/lib/school/portflow";

export const dynamic = "force-dynamic";

const TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
type ImageType = (typeof TYPES)[number];
// A screenshot is well under this; anything bigger is not what we expect.
const MAX_BYTES = 10 * 1024 * 1024;

/** Screenshots of Portflow's "Mijn bewijs", one Haiku vision call each; same import as the Telegram /portflow flow. */
export async function POST(req: Request) {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return new Response("Geen afbeeldingen", { status: 400 });
  const rows = [];
  for (const file of files) {
    if (!TYPES.includes(file.type as ImageType) || file.size > MAX_BYTES) return new Response(`${file.name}: geen png/jpg/webp tot 10 MB`, { status: 400 });
    rows.push(...(await readScreenshot(Buffer.from(await file.arrayBuffer()), file.type as ImageType)));
  }
  const result = await importEvidence(rows);
  return Response.json({ ...result, names: rows.map((r) => r.name) });
}
