import { listMemories } from "@/lib/memory/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listMemories();
  return Response.json({ items });
}
