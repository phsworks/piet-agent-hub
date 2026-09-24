import { listFeeds, syncFeeds } from "@/lib/calendar/feeds";

export const dynamic = "force-dynamic";

export async function POST() {
  await syncFeeds();
  return Response.json(await listFeeds());
}
