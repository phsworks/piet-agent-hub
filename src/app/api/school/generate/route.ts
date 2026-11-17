import { generate, savePrompt, savedGenerated, type GenerateKind } from "@/lib/school/generate";

export const dynamic = "force-dynamic";
const KINDS: GenerateKind[] = ["docs", "document", "link"];

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return new Response("key required", { status: 400 });
  return Response.json(await savedGenerated(key));
}

export async function PUT(req: Request) {
  const { key, prompt } = (await req.json()) as { key?: unknown; prompt?: unknown };
  if (typeof key !== "string" || typeof prompt !== "string") return new Response("key and prompt required", { status: 400 });
  await savePrompt(key, prompt);
  return Response.json({ ok: true });
}

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
  const key = str("key");
  const prompt = str("prompt")?.trim();
  const kind = str("kind") as GenerateKind;
  if (!key || !prompt || !KINDS.includes(kind)) return new Response("key, prompt and kind required", { status: 400 });
  try {
    return Response.json(await generate({ key, kind, prompt, hint: str("hint") ?? "", previous: str("previous"), instruction: str("instruction")?.trim() }));
  } catch (err) {
    console.error("[school] generate failed", err);
    return new Response(err instanceof Error ? err.message : "Genereren mislukt", { status: 500 });
  }
}
