import { getPlanning, planningSprints } from "@/lib/school/planning";

export const dynamic = "force-dynamic";

export async function GET() {
  const planning = await getPlanning();
  return Response.json({ planning, sprints: planningSprints(planning) });
}
