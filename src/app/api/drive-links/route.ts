import { NextRequest } from "next/server";
import { linkDriveFolder } from "@/lib/files/drive-links";
import { GoogleNotConnectedError } from "@/lib/google/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { agentId?: string; url?: string };
  if (!body.agentId || !body.url) return new Response("agentId and url are required", { status: 400 });
  try {
    const result = await linkDriveFolder(body.agentId, body.url);
    return Response.json(result);
  } catch (err) {
    const status = err instanceof GoogleNotConnectedError ? 409 : 400;
    return new Response(err instanceof Error ? err.message : "Failed", { status });
  }
}
