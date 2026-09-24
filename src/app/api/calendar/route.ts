import { NextRequest } from "next/server";
import { listEvents } from "@/lib/calendar/feeds";

export const dynamic = "force-dynamic";

const MAX_DAYS = 60;

// Upcoming events: from now (including ones still going on) for ?days days.
export async function GET(req: NextRequest) {
  const days = Math.min(Number(req.nextUrl.searchParams.get("days")) || 7, MAX_DAYS);
  const now = new Date();
  return Response.json(await listEvents(now, new Date(now.getTime() + days * 86_400_000)));
}
