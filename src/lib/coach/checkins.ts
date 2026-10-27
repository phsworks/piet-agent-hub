import Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_MODEL, CONTENT_LANGUAGE } from "@/lib/config";
import { listEvents } from "@/lib/calendar/feeds";
import { listTasks, type Task } from "@/lib/ticktick/client";
import { addDays, dayKey, isoWeekday, timeKey, weekStart, zonedDate } from "@/lib/dates";
import { formatDue } from "@/lib/telegram/quick";
import { isDayPart, progressLine, weekProgress, type GoalProgress } from "./goals";
import { findSlots, formatSlot, type Slot } from "./slots";
import { getSetting, setSetting } from "@/lib/settings";
import { getCoachPrefs } from "./prefs";
import { allProgress, progressSummary, projectDeadlines } from "@/lib/gitlab/progress";
import { schoolFacts, schoolMorningFact, schoolPicture } from "@/lib/school/priorities";
import { portflowFact, portflowReport } from "@/lib/school/portflow";
import {
  claimKey,
  goalsSuggestedToday,
  sendPrompt,
  suggestionButtons,
  type CheckItem,
  type EveningPayload,
  type PlanItem,
  type SuggestionPayload,
  type WeeklyPayload,
} from "./prompts";

const anthropic = new Anthropic();

// Recent morning tech facts, passed to Haiku so it picks a new topic.
const TECH_FACTS_KEY = "coach_tech_facts";
const TECH_FACTS_KEPT = 30;
const TECH_FACT_LABEL = "Tech-feitje:";

const techFactInstruction = (recent: string[]) =>
  `Then add an empty line and one line starting with "${TECH_FACT_LABEL}": one correct, concrete and slightly surprising fact for an HBO-ICT student who builds AI apps, explained in at most 2 sentences. Vary the field: how APIs and HTTP work, networking and DNS, databases, operating systems, hardware, security, Git, programming languages, AI/LLMs, computing history.${
    recent.length ? ` Pick a different topic than these recent ones:\n${recent.map((f) => `- ${f}`).join("\n")}` : ""
  }`;

/** Keeps the fact from today's message, so tomorrow's is about something else. */
async function rememberTechFact(text: string) {
  const fact = text.split("\n").find((l) => l.startsWith(TECH_FACT_LABEL));
  if (!fact) return;
  const recent = (await getSetting<string[]>(TECH_FACTS_KEY)) ?? [];
  await setSetting(TECH_FACTS_KEY, [fact.slice(TECH_FACT_LABEL.length).trim().slice(0, 160), ...recent].slice(0, TECH_FACTS_KEPT));
}

// The morning check-in mentions GitLab milestones and issues due within this many days.
const COACH_PROJECT_DAYS = 3;

// Evening check: buttons per item, so keep the list short.
const MAX_CHECK_ITEMS = 6;

const COACH_SYSTEM = `You are Piet's personal coach in Telegram. Piet is an HBO-ICT student (HvA) who also works as an AI developer. You help him keep his week on track and not forget things, without nagging.
Write in ${CONTENT_LANGUAGE}, like a short chat message from a friend who has his back: warm, direct, concrete. Use only the facts you are given; never invent appointments. Plain text only: no markdown, no headings, at most one emoji. Don't list the buttons; they are shown below your message.`;

/** A short coach message written by Haiku; falls back to the plain facts when the call fails. */
async function coachText(instruction: string, facts: string, fallback: string) {
  try {
    const response = await anthropic.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 600,
      system: COACH_SYSTEM,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: `${instruction}\n\nFacts:\n${facts}` }],
    });
    console.log(`[tokens] coach in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || fallback;
  } catch (err) {
    console.error("[coach] writing the message failed", err);
    return fallback;
  }
}

const eventLine = (e: { allDay: boolean; startsAt: string; endsAt: string; title: string }) =>
  e.allDay ? `hele dag ${e.title}` : `${timeKey(new Date(e.startsAt))}–${timeKey(new Date(e.endsAt))} ${e.title}`;

const taskLine = (t: Task, today: string) =>
  `${t.title}${t.dueDay! < today ? " (te laat)" : t.dueTime ? ` (${t.dueTime})` : ""}${t.list !== "Inbox" ? ` [${t.list}]` : ""}`;

/** The first free slot for a goal that still needs sessions, within [fromDay, untilDay]. */
export async function goalSuggestion(p: GoalProgress, fromDay: string, untilDay: string): Promise<PlanItem | null> {
  const { goal } = p;
  if (!goal.durationMinutes || p.remaining === 0) return null;
  const preferred = isDayPart(goal.preferred) ? goal.preferred : "any";
  const days = Math.round((Date.parse(untilDay) - Date.parse(fromDay)) / 86_400_000) + 1;
  const [slot] = await findSlots({
    fromDay,
    days,
    durationMinutes: goal.durationMinutes,
    preferred,
    excludeDays: p.busyDays,
    limit: 1,
  });
  return slot ? { title: goal.title, calendar: goal.calendar, slot, goalId: goal.id, durationMinutes: goal.durationMinutes } : null;
}

export function suggestionPayload(text: string, item: PlanItem, p: GoalProgress | null, untilDay: string): SuggestionPayload {
  return {
    text,
    item,
    search: { preferred: p?.goal.preferred ?? "any", untilDay, excludeDays: p?.busyDays ?? [] },
  };
}

/** Morning check-in: today's plan, open tasks, and one concrete suggestion when a goal is behind. */
export async function morningCheckin() {
  const today = dayKey();
  const sunday = addDays(weekStart(today), 6);
  const [events, tasks, progress, suggested, prefs, recentFacts, projectDue, school] = await Promise.all([
    listEvents(zonedDate(today), zonedDate(addDays(today, 1))),
    listTasks().catch(() => null),
    weekProgress(today),
    goalsSuggestedToday(),
    getCoachPrefs(),
    getSetting<string[]>(TECH_FACTS_KEY),
    projectDeadlines(addDays(today, COACH_PROJECT_DAYS)),
    schoolPicture().catch(() => null),
  ]);
  const due = tasks?.filter((t) => t.dueDay && t.dueDay <= today) ?? [];

  // The goal furthest from its target that fits in today or tomorrow.
  let suggestion: { item: PlanItem; progress: GoalProgress } | null = null;
  const behind = progress
    .filter((p) => p.remaining > 0 && p.goal.durationMinutes && !suggested.has(p.goal.id))
    .sort((a, b) => b.remaining - a.remaining);
  for (const p of behind) {
    const item = await goalSuggestion(p, today, addDays(today, 1) > sunday ? today : addDays(today, 1));
    if (item) {
      suggestion = { item, progress: p };
      break;
    }
  }

  const facts = [
    `Today: ${formatDue(today, null)}`,
    `Calendar today: ${events.length ? events.map(eventLine).join("; ") : "nothing"}`,
    tasks === null ? "TickTick not connected." : `Tasks due today or overdue: ${due.length ? due.map((t) => taskLine(t, today)).join("; ") : "none"}`,
    progress.length ? `Goals this week: ${progress.map(progressLine).join("; ")}` : "No goals set.",
    projectDue.length ? `GitLab deadlines soon: ${projectDue.map((d) => `${d.project}: ${d.title} (${formatDue(d.dueOn, null)})`).join("; ")}` : "",
    school && prefs.schoolNudges ? schoolMorningFact(school) : "",
    suggestion
      ? `Suggestion to plan: ${suggestion.item.title} ${formatSlot(suggestion.item.slot)} (buttons below let him plan it)`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const fallback = `☀️ Goedemorgen!\n${facts}`;
  const text = await coachText(
    "Write the morning check-in: greet briefly, give the shape of his day in one or two sentences, mention what must not be forgotten, if there is a school focus name it in one sentence with its reason (and that he can see more with /school), and if there is a suggestion, propose it with the exact time. Max 6 sentences." +
      (prefs.techFact ? `\n${techFactInstruction(recentFacts ?? [])}` : ""),
    facts,
    fallback
  );
  if (prefs.techFact) await rememberTechFact(text).catch((err) => console.error("[coach] saving the tech fact failed", err));

  const display = `☀️ ${text.replace(/^☀️\s*/, "")}`;
  await sendPrompt({
    kind: "morning",
    dedupKey: `morning:${today}`,
    text: display,
    goalId: suggestion?.progress.goal.id,
    payload: suggestion ? suggestionPayload(display, suggestion.item, suggestion.progress, sunday) : { text: display },
    buttons: (id) => (suggestion ? suggestionButtons(id) : []),
  });
}

/** Evening check (no AI): tick off today's routines and today's tasks. */
export async function eveningCheck() {
  const today = dayKey();
  const [progress, tasks] = await Promise.all([weekProgress(today), listTasks().catch(() => null)]);

  const items: CheckItem[] = [
    // Routines without calendar time that weren't ticked off today and still count this week.
    ...progress
      // Routines with their own reminder time (e.g. reading at 23:30) are asked about then instead.
      .filter((p) => !p.goal.durationMinutes && !p.goal.remindAt && !p.busyDays.includes(today) && p.done < p.goal.timesPerWeek)
      .map((p): CheckItem => ({ type: "goal", id: p.goal.id, title: p.goal.title })),
    ...(tasks ?? [])
      .filter((t) => t.dueDay && t.dueDay <= today)
      .map((t): CheckItem => ({ type: "task", id: t.id, title: t.title, dueTime: t.dueTime })),
  ].slice(0, MAX_CHECK_ITEMS);

  if (items.length === 0) {
    await claimKey("evening", `evening:${today}`);
    return;
  }

  const tomorrow = addDays(today, 1);
  const first = (await listEvents(zonedDate(tomorrow), zonedDate(addDays(tomorrow, 1)))).find((e) => !e.allDay);
  const text = [
    "🌙 Avondcheck. Hoe ging het vandaag? Tik af wat gelukt is.",
    first ? `Morgen begint om ${timeKey(new Date(first.startsAt))} met ${first.title}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const payload: EveningPayload = { text, items };
  await sendPrompt({ kind: "evening", dedupKey: `evening:${today}`, text, payload, buttons: (id) => eveningButtons(id, items) });
}

export function eveningButtons(id: string, items: CheckItem[]) {
  const short = (s: string) => (s.length > 22 ? `${s.slice(0, 21)}…` : s);
  return items.flatMap((item, i) =>
    item.state
      ? []
      : [
          item.type === "goal"
            ? [
                { text: `✓ ${short(item.title)}`, data: `c:${id}:d${i}` },
                { text: "✗ niet", data: `c:${id}:n${i}` },
              ]
            : [
                { text: `✓ ${short(item.title)}`, data: `c:${id}:d${i}` },
                { text: "→ morgen", data: `c:${id}:m${i}` },
              ],
        ]
  );
}

/** Spreads n picks evenly over the candidates (one per day), so sessions aren't on consecutive days. */
function spread<T>(candidates: T[], n: number) {
  if (n >= candidates.length) return candidates;
  return Array.from({ length: n }, (_, i) => candidates[Math.floor(((i + 0.5) * candidates.length) / n)]);
}

/** Sunday review: how the week went and a ready-made plan for next week's goals. */
export async function weeklyReview() {
  const today = dayKey();
  if (isoWeekday(today) !== 7) return;
  const monday = addDays(today, 1);
  const [thisWeek, nextWeek, events, tasks, projects, projectDue, school, prefs, portflow] = await Promise.all([
    weekProgress(today),
    weekProgress(monday),
    listEvents(zonedDate(monday), zonedDate(addDays(monday, 7))),
    listTasks().catch(() => null),
    allProgress(7),
    projectDeadlines(addDays(monday, 6), monday),
    schoolPicture().catch(() => null),
    getCoachPrefs(),
    portflowReport().catch(() => null),
  ]);

  // Plan the sessions next week still needs; one goal per day where possible.
  const plan: PlanItem[] = [];
  const usedDays = new Set<string>();
  for (const p of nextWeek) {
    const { goal } = p;
    if (!goal.durationMinutes || p.remaining === 0) continue;
    const candidates: Slot[] = await findSlots({
      fromDay: monday,
      days: 7,
      durationMinutes: goal.durationMinutes,
      preferred: isDayPart(goal.preferred) ? goal.preferred : "any",
      excludeDays: p.busyDays,
    });
    const free = candidates.filter((s) => !usedDays.has(dayKey(new Date(s.start))));
    const picks = spread(free.length >= p.remaining ? free : candidates, p.remaining);
    for (const slot of picks) {
      usedDays.add(dayKey(new Date(slot.start)));
      plan.push({ title: goal.title, calendar: goal.calendar, slot, goalId: goal.id, durationMinutes: goal.durationMinutes });
    }
  }
  plan.sort((a, b) => a.slot.start.localeCompare(b.slot.start));

  const busyPerDay = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(monday, i);
    const count = events.filter((e) => !e.allDay && dayKey(new Date(e.startsAt)) === day).length;
    return `${formatDue(day, null)}: ${count} afspraken`;
  });
  const dueNextWeek = tasks?.filter((t) => t.dueDay && t.dueDay <= addDays(monday, 6)) ?? [];
  const facts = [
    thisWeek.length ? `This week's goals: ${thisWeek.map(progressLine).join("; ")}` : "No goals set.",
    `Next week busy-ness: ${busyPerDay.join("; ")}`,
    projects.length ? `GitLab projects this week: ${projects.map(progressSummary).join("; ")}` : "",
    projectDue.length ? `GitLab deadlines next week: ${projectDue.map((d) => `${d.project}: ${d.title} (${formatDue(d.dueOn, null)})`).join("; ")}` : "",
    school && prefs.schoolNudges ? schoolFacts(school) : "",
    portflow && prefs.portflowReminders ? portflowFact(portflow) : "",
    `Tasks due next week or overdue: ${dueNextWeek.length ? dueNextWeek.map((t) => `${t.title} (${formatDue(t.dueDay, t.dueTime)})`).join("; ") : "none"}`,
    plan.length ? `Proposed plan for next week: ${plan.map((p) => `${p.title} ${formatSlot(p.slot)}`).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const planLines = plan.map((p) => `- ${p.title} ${formatSlot(p.slot)}`).join("\n");
  const text = await coachText(
    "Write the Sunday weekly review: one or two sentences on how the goals went this week (honest, encouraging), one sentence on his projects if there is GitLab data (progress, a milestone coming up), one or two sentences on school if there is roadmap data (which theme is behind, what to focus on next week, anything done but not yet in Portflow, and what's missing in Portflow for the current sprint if there is Portflow data, mentioning /portflow), one sentence on what stands out next week (busy days, deadlines). Do NOT list the proposed plan; it is added below your message. Max 7 sentences.",
    facts,
    `Weekreview\n${facts}`
  );
  const full = plan.length ? `📊 ${text}\n\nVoorstel voor volgende week:\n${planLines}` : `📊 ${text}`;
  const payload: WeeklyPayload = { text: full, plan };
  await sendPrompt({
    kind: "weekly",
    dedupKey: `weekly:${today}`,
    text: full,
    payload,
    buttons: (id) =>
      plan.length
        ? [
            [
              { text: "✓ Alles inplannen", data: `c:${id}:all` },
              { text: "Overslaan", data: `c:${id}:skip` },
            ],
          ]
        : [],
  });
}
