import { ensureBriefing } from "@/lib/briefing/generate";

export const dynamic = "force-dynamic";

// Today's message; written on the spot if the scheduled run hasn't happened yet.
export async function GET() {
  try {
    return Response.json(await ensureBriefing());
  } catch (err) {
    console.error("Daily briefing failed", err);
    return new Response("Couldn't write today's message", { status: 500 });
  }
}

// Rewrite it, e.g. after adding reminders.
export async function POST() {
  try {
    return Response.json(await ensureBriefing({ regenerate: true }));
  } catch (err) {
    console.error("Daily briefing failed", err);
    return new Response("Couldn't write today's message", { status: 500 });
  }
}
