import { disconnectTickTick, getTickTickStatus } from "@/lib/ticktick/auth";
import { listTaskLists } from "@/lib/ticktick/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getTickTickStatus();
  if (!status.connected) return Response.json({ ...status, lists: [] });
  // Reading the lists doubles as a live check that the token still works.
  const lists = await listTaskLists().catch((err: Error) => ({ error: err.message }));
  return Response.json(
    Array.isArray(lists) ? { ...status, lists: lists.map((l) => l.name) } : { ...status, lists: [], error: lists.error }
  );
}

export async function DELETE() {
  await disconnectTickTick();
  return Response.json({ ok: true });
}
