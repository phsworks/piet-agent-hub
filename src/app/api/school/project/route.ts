import { projectOverview, setProjectCheck } from "@/lib/school/project";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await projectOverview());
}

export async function PATCH(req: Request) {
  const { id, done } = (await req.json()) as { id?: unknown; done?: unknown };
  if (typeof id !== "string" || typeof done !== "boolean") return new Response("id and done required", { status: 400 });
  if (!(await setProjectCheck(id, done))) return new Response("Unknown check", { status: 404 });
  return Response.json({ ok: true });
}
