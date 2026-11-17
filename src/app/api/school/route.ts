import { portflowMirror } from "@/lib/school/mirror";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await portflowMirror());
}
