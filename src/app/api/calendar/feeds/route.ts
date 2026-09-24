import { addFeed, listFeeds, syncFeeds } from "@/lib/calendar/feeds";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listFeeds());
}

// Adds an iCal feed and syncs it right away, so a bad link shows up immediately.
export async function POST(req: Request) {
  const body = (await req.json()) as { name?: string; url?: string };
  const url = body.url?.trim() ?? "";
  if (!/^(https?|webcal):\/\//i.test(url)) {
    return new Response("Paste an https:// or webcal:// iCal link", { status: 400 });
  }
  const feed = await addFeed(body.name ?? "", url);
  await syncFeeds(feed.id);
  const saved = (await listFeeds()).find((f) => f.id === feed.id);
  return Response.json(saved);
}
