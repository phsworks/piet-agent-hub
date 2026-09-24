import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { dailyBriefings } from "@/lib/db/schema";
import { getAgentBySlug } from "@/lib/agents/registry";
import { listEvents } from "@/lib/calendar/feeds";
import { listDoneSince, listReminders } from "@/lib/reminders/store";
import { searchMemories } from "@/lib/memory/store";
import { addDays, dayKey } from "@/lib/dates";
import { BRAIN_SLUG, CONTENT_LANGUAGE, MODEL_NAME, TIMEZONE } from "@/lib/config";

const anthropic = new Anthropic();
const CALENDAR_DAYS = 7;
const DEADLINE_DAYS = 14;

const SYSTEM = `You are the Brain of Piet's personal assistant, writing his short daily message for the home screen. Piet is an HBO-ICT student (HvA) who also works as an AI developer and has side projects.

Write in ${CONTENT_LANGUAGE}, informal, like a friend who knows his schedule. Structure:
1. One short opening line for today (no "Goedemorgen Piet!"-style filler; be specific).
2. 2 to 4 '- ' bullets: what matters today and what to prepare for soon. Mention overdue items and deadlines within a few days with their day. Leave out things that don't need attention.
3. One closing line that keeps him going: encouraging and personal (refer to something he finished or is working on when you can), never cheesy or generic.

Plain text and '- ' bullets only, no headings or bold. Max ~90 words. Don't invent events or deadlines.`;

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("nl-NL", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" });
}

async function buildContext(today: string) {
  const now = new Date();
  const [events, open, doneRecently, brain, memories] = await Promise.all([
    listEvents(new Date(`${today}T00:00:00`), new Date(Date.now() + CALENDAR_DAYS * 86_400_000)),
    listReminders(),
    listDoneSince(new Date(now.getTime() - 2 * 86_400_000)),
    getAgentBySlug(BRAIN_SLUG),
    searchMemories("deadlines, goals, what Piet is working on now", 8),
  ]);

  const eventLines = events.map((e) => {
    const day = dayKey(new Date(e.startsAt));
    const when = e.allDay ? `${day} (all day)` : `${day} ${time(e.startsAt)}-${time(e.endsAt)}`;
    return `- ${when}: ${e.title}${e.location ? ` @ ${e.location}` : ""}`;
  });

  const horizon = addDays(today, DEADLINE_DAYS);
  const accepted = open.filter((r) => r.status === "open");
  const dated = accepted.filter((r) => r.dueDate && r.dueDate <= horizon);
  const undated = accepted.filter((r) => !r.dueDate);
  const reminderLine = (r: (typeof open)[number]) =>
    `- ${r.dueDate ? `${r.dueDate}${r.dueDate < today ? " (OVERDUE)" : ""}: ` : ""}${r.title}${r.agentName ? ` [${r.agentName}]` : ""}`;

  return [
    `Today is ${today} (${new Date().toLocaleDateString("en-GB", { timeZone: TIMEZONE, weekday: "long" })}).`,
    `Schedule, next ${CALENDAR_DAYS} days:\n${eventLines.join("\n") || "- nothing scheduled"}`,
    `Deadlines (next ${DEADLINE_DAYS} days and overdue):\n${dated.map(reminderLine).join("\n") || "- none"}`,
    undated.length ? `Open reminders without a date:\n${undated.slice(0, 10).map(reminderLine).join("\n")}` : "",
    doneRecently.length ? `Recently finished:\n${doneRecently.map((r) => `- ${r.title}`).join("\n")}` : "",
    brain?.overview ? `Profile of Piet:\n${brain.overview.slice(0, 2500)}` : "",
    memories.length ? `Remembered:\n${memories.map((m) => `- ${m.content}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function generateBriefing(today = dayKey()) {
  const response = await anthropic.messages.create({
    model: MODEL_NAME,
    max_tokens: 600,
    system: SYSTEM,
    messages: [{ role: "user", content: await buildContext(today) }],
  });
  const message = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const [row] = await db
    .insert(dailyBriefings)
    .values({ date: today, message })
    .onConflictDoUpdate({ target: dailyBriefings.date, set: { message, createdAt: new Date() } })
    .returning();
  return row;
}

// One generation at a time, even if cron, startup and the home screen ask at once.
const pending = ((globalThis as unknown as { __briefing?: Map<string, Promise<Briefing>> }).__briefing ??=
  new Map());
type Briefing = typeof dailyBriefings.$inferSelect;

/** Today's briefing, written first if it doesn't exist yet. */
export async function ensureBriefing(opts: { regenerate?: boolean } = {}): Promise<Briefing> {
  const today = dayKey();
  if (!opts.regenerate) {
    const [existing] = await db.select().from(dailyBriefings).where(eq(dailyBriefings.date, today));
    if (existing) return existing;
  }
  let job = pending.get(today);
  if (!job) {
    job = generateBriefing(today).finally(() => pending.delete(today));
    pending.set(today, job);
  }
  return job;
}
