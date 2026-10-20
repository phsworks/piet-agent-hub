import { checkGoogle, disconnectGoogle } from "@/lib/google/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await checkGoogle());
}

export async function DELETE() {
  await disconnectGoogle();
  return Response.json({ ok: true });
}
