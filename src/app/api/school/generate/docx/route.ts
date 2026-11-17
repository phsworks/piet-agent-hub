import { toDocx } from "@/lib/school/generate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { title, markdown } = (await req.json()) as { title?: unknown; markdown?: unknown };
  if (typeof title !== "string" || typeof markdown !== "string" || !markdown.trim()) return new Response("title and markdown required", { status: 400 });
  try {
    const docx = await toDocx(title, markdown);
    const name = `${title.replace(/[^\w\- ]+/g, "").trim() || "document"}.docx`;
    return new Response(new Uint8Array(docx), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (err) {
    console.error("[school] docx failed", err);
    return new Response(err instanceof Error ? err.message : "Word-bestand maken mislukt (is Google gekoppeld?)", { status: 500 });
  }
}
