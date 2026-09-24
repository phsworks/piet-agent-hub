import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { driveLinks } from "@/lib/db/schema";
import { syncDriveLink } from "@/lib/files/drive-links";

export const dynamic = "force-dynamic";

/** Re-syncs the linked folder. */
export async function POST(_req: Request, ctx: RouteContext<"/api/drive-links/[id]">) {
  const { id } = await ctx.params;
  try {
    return Response.json(await syncDriveLink(id));
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Failed", { status: 400 });
  }
}

/** Unlinks the folder; its files leave the app but stay in Drive. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/drive-links/[id]">) {
  const { id } = await ctx.params;
  await db.delete(driveLinks).where(eq(driveLinks.id, id));
  return Response.json({ ok: true });
}
