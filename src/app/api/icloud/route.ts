import { getICloudStatus, listICloudCalendars, syncICloud } from "@/lib/icloud/caldav";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getICloudStatus();
  if (!status.configured) return Response.json({ ...status, calendars: [] });
  const calendars = await listICloudCalendars().catch((err: Error) => ({ error: err.message }));
  return Response.json(
    Array.isArray(calendars)
      ? { ...status, calendars: calendars.map((c) => c.name) }
      : { ...status, calendars: [], lastError: calendars.error }
  );
}

// "Sync now" in Settings.
export async function POST() {
  return Response.json(await syncICloud({ force: true }));
}
