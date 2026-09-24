import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { kickWorker } from "@/lib/files/worker";

export const dynamic = "force-dynamic";

/** Removes the file from the app (search + dashboard). The copy in Drive is kept. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  await db.delete(files).where(eq(files.id, id));
  return Response.json({ ok: true });
}

/** Retries a failed file. */
export async function POST(_req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  await db.update(files).set({ status: "queued", error: null }).where(eq(files.id, id));
  kickWorker();
  return Response.json({ ok: true });
}
