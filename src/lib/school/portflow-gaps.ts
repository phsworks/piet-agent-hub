import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { gitlabItems, gitlabProjects } from "@/lib/db/schema";
import { ASSISTANT_MODEL, CONTENT_LANGUAGE, PORTFLOW } from "@/lib/config";
import { addDays, dayKey, timeKey, zonedDate } from "@/lib/dates";
import { listEvents } from "@/lib/calendar/feeds";
import { formatDue } from "@/lib/telegram/quick";
import { DEADLINE_WORDS, focusLine, schoolPicture, themeLine } from "./priorities";
import { listEvidence, portflowReport, reportText } from "./portflow";
import { currentSprints } from "./sprints";

// "Wat mist er nu in mijn Portflow?" (📎 Portflow button). The check in
// portflow.ts only looks at the sprint events and goals; this adds today's
// date, where the sprint is, the agenda, the roadmap and what Piet actually
// built in GitLab, and lets one Haiku call turn that into a to-do list.

const anthropic = new Anthropic();

// Far enough ahead to see the next review or assessment coming.
const AGENDA_DAYS = 14;
// Enough of Piet's own GitLab work to name concrete evidence.
const MAX_WORK = 25;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

async function gather(today: string) {
  const [{ sprints, current, previous }, report, picture, evidence] = await Promise.all([
    currentSprints(today),
    portflowReport(today),
    schoolPicture(),
    listEvidence(),
  ]);
  const since = previous?.start ?? current?.start ?? addDays(today, -28);

  const [work, events] = await Promise.all([
    // Own closed issues and merged MRs in school projects: things that could be evidence.
    db
      .select({ type: gitlabItems.type, title: gitlabItems.title, state: gitlabItems.state, project: gitlabProjects.name, at: gitlabItems.happenedAt })
      .from(gitlabItems)
      .innerJoin(gitlabProjects, eq(gitlabItems.projectId, gitlabProjects.id))
      .where(and(eq(gitlabItems.mine, true), eq(gitlabProjects.kind, "school"), gte(gitlabItems.happenedAt, zonedDate(since)))),
    listEvents(zonedDate(addDays(today, -7)), zonedDate(addDays(today, AGENDA_DAYS + 1))).catch(() => []),
  ]);
  const done = work
    .filter((w) => (w.type === "issue" && w.state === "closed") || (w.type === "mr" && w.state === "merged"))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, MAX_WORK);
  const moments = events.filter((e) => DEADLINE_WORDS.test(e.title));

  const sprintLine = current
    ? `${current.name} runs ${formatDue(current.start, null)} to ${formatDue(current.end, null)}: day ${daysBetween(current.start, today) + 1}, ${Math.max(daysBetween(today, current.end), 0)} days left.${
        previous ? ` Previous: ${previous.name}, ended ${formatDue(previous.end, null)}.` : ""
      }`
    : "No running sprint found in GitLab.";
  const last = report.last ? dayKey(report.last) : null;
  // The roadmap's outcome codes look like "OR3-2"; Portflow's goals are just "OR".
  const codes = new Map(picture.all.filter((i) => i.kind === "outcome" && i.code).map((i) => [i.id, i.code!.replace(/[^A-Z].*$/, "")]));

  return [
    `Today: ${formatDue(today, null)} (${today}).`,
    sprintLine,
    `Every sprint needs in Portflow: ${PORTFLOW.perSprint.map((c) => c.label).join(", ")}; evidence for each goal (${Object.entries(PORTFLOW.goals).map(([k, v]) => `${k} ${v}`).join(", ")}).`,
    last
      ? `Last Portflow screenshot: ${last} (${daysBetween(last, today)} days ago); anything added after that isn't known.`
      : "Piet never sent Portflow screenshots, so what's in Portflow is unknown except roadmap items he marked in_portflow.",
    `Computed check:\n${reportText(report)}`,
    evidence.length ? `All evidence this semester:\n${evidence.filter((e) => !sprints[0] || e.createdOn >= sprints[0].start).map((e) => `- ${e.createdOn} ${e.name} [${e.goals.join(", ") || "no goal"}]`).join("\n")}` : "",
    `Roadmap progress per theme (done/total): ${picture.themes.map(themeLine).join("; ")}`,
    `Side quests and products with status and the goals they count for:\n${picture.tracked
      .map((i) => {
        const deadline = picture.deadlines.get(i.id);
        const goals = (i.links.outcomes ?? []).map((id) => codes.get(id)).filter(Boolean);
        return `- ${i.title} (${i.kind === "product" ? "product" : "side quest"}, ${i.theme ?? "-"}${goals.length ? `, ${goals.join("/")}` : ""}): ${i.status}${deadline ? `, deadline ${deadline.title} ${deadline.day}` : ""}`;
      })
      .join("\n")}`,
    picture.focus.length ? `Suggested focus: ${picture.focus.map(focusLine).join("; ")}` : "",
    done.length ? `Piet's finished GitLab work since ${since} (possible evidence):\n${done.map((w) => `- ${dayKey(w.at)} ${w.type === "mr" ? "MR" : "issue"} ${w.title} (${w.project})`).join("\n")}` : "No finished GitLab work of Piet's in school projects since the previous sprint.",
    moments.length
      ? `Agenda (last week and next ${AGENDA_DAYS} days): ${moments.map((e) => `${e.title} ${formatDue(dayKey(new Date(e.startsAt)), e.allDay ? null : timeKey(new Date(e.startsAt)))}`).join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The list of what's missing in Portflow right now, as plain text for Telegram. One Haiku call. */
export async function portflowGaps(today = dayKey()) {
  const facts = await gather(today);
  const response = await anthropic.messages.create({
    model: ASSISTANT_MODEL,
    // Haiku thinks before it writes; this leaves room for both.
    max_tokens: 4000,
    output_config: { effort: "low" },
    system: `You are Piet's study coach. Piet is an HBO-ICT propedeuse student at the HvA (semester 2) working in a team project in sprints; his portfolio is in Portflow, where each piece of evidence is linked to collections (themes) and goals (learning outcomes). Write in ${CONTENT_LANGUAGE}, plain text for Telegram, no markdown headings or bold.
Give the list of what is missing in his Portflow at this moment, in three groups, each a short header line followed by "- " items, and leave out empty groups:
"🔴 Nu" (overdue, or for a sprint that ended or a review/assessment within a few days),
"🟡 Deze sprint" (should be in before the current sprint ends),
"⚪ Later".
Nothing has to be finished mid-semester: during the sprints Piet shows progress per learning goal with interim evidence, so suggest things he already did that show a goal, not items to complete. Portflow is for his personal progress (reflections, feedback he got, his own contribution with a link); technical team work stays in the group's GitLab and is linked as evidence. Always include the technical evidence that should be there at minimum (from his finished GitLab work: merged MRs, architecture, database, tests, deployment), linked to OR. No time estimates or hours.
Each item: what to add (name the concrete document, finished GitLab work or roadmap item), to which goal (OR/PL/AA/MS) it should be linked (the goals given with the item when there are any), and why now (date, sprint, deadline). Only mention sprints and dates that are in the facts; without a running sprint, skip "Deze sprint" and sort by deadline and what's started. Don't list things that are already there. Things marked klaar in the roadmap but not seen in Portflow go first. At most 10 items. If the screenshots are older than a week, end with one line saying the list is based on the screenshot of that date. Use only the facts given.`,
    messages: [{ role: "user", content: facts }],
  });
  console.log(`[tokens] portflow gaps in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return `📎 Wat mist er nu in Portflow\n\n${text}`;
}
