import { getGoogleStatus, disconnectGoogle } from "@/lib/google/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getGoogleStatus());
}

export async function DELETE() {
  await disconnectGoogle();
  return Response.json({ ok: true });
}
