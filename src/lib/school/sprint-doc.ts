import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { gitlabItems, gitlabProjects, roadmapItems } from "@/lib/db/schema";
import { CONTENT_LANGUAGE, DEEP_MODEL } from "@/lib/config";
import { addDays, dayKey, timeKey, zonedDate } from "@/lib/dates";
import { listEvents } from "@/lib/calendar/feeds";
import { formatDue } from "@/lib/telegram/quick";
import { listSprints, sprintInName, sprintOn, type Sprint } from "./sprints";
import { listEvidence } from "./portflow";

// A first draft of the Sprint Review or Retrospective document, on the
// roadmap's own template, filled with what the hub knows about that sprint:
// the milestone's issues, merged MRs, Piet's commits, review/retro moments in
// his agenda and his Portflow evidence. What only the team knows (who was
// there, the stakeholders' feedback) is left as [aanvullen: …].

const anthropic = new Anthropic();

export type SprintDocKind = "review" | "retro";
const ASSIGNMENT: Record<SprintDocKind, string> = { review: "Sprint Review", retro: "Retrospective" };
const AGENDA_WORDS: Record<SprintDocKind, RegExp> = { review: /review|demo|oplevering/i, retro: /retro/i };
// Enough to see what he worked on without flooding the prompt.
const MAX_COMMITS = 40;

/** The sprint to write about: the one asked for, else the last one that ended (or the running one if none has). */
export async function pickSprint(number: number | null, today: string): Promise<Sprint | null> {
  const sprints = (await listSprints()).filter((s) => s.number > 0);
  if (number !== null) return sprints.find((s) => s.number === number) ?? null;
  const ended = sprints.filter((s) => s.end < today);
  return ended.at(-1) ?? sprintOn(sprints, today);
}

async function sprintFacts(sprint: Sprint, kind: SprintDocKind) {
  const from = zonedDate(sprint.start);
  const until = zonedDate(sprint.until);
  const [issues, mrs, commits, events, evidence] = await Promise.all([
    db
      .select({ title: gitlabItems.title, state: gitlabItems.state, mine: gitlabItems.mine, labels: gitlabItems.labels, project: gitlabProjects.name })
      .from(gitlabItems)
      .innerJoin(gitlabProjects, eq(gitlabItems.projectId, gitlabProjects.id))
      .where(and(eq(gitlabItems.type, "issue"), eq(gitlabItems.milestone, sprint.name))),
    db
      .select({ title: gitlabItems.title, mine: gitlabItems.mine, project: gitlabProjects.name })
      .from(gitlabItems)
      .innerJoin(gitlabProjects, eq(gitlabItems.projectId, gitlabProjects.id))
      .where(and(eq(gitlabItems.type, "mr"), eq(gitlabItems.state, "merged"), gte(gitlabItems.closedAt, from), lt(gitlabItems.closedAt, until))),
    db
      .select({ title: gitlabItems.title, mine: gitlabItems.mine })
      .from(gitlabItems)
      .where(and(eq(gitlabItems.type, "commit"), gte(gitlabItems.happenedAt, from), lt(gitlabItems.happenedAt, until))),
    // The review/retro itself is usually on the sprint's last day or just after it.
    listEvents(from, zonedDate(addDays(sprint.until, 3))).catch(() => []),
    listEvidence(),
  ]);

  const own = commits.filter((c) => c.mine);
  const inSprint = evidence.filter((e) => {
    const named = sprintInName(e.name);
    return named !== null ? named === sprint.number : e.createdOn >= sprint.start && e.createdOn < sprint.until;
  });
  const moments = events.filter((e) => AGENDA_WORDS[kind].test(e.title));

  return [
    `${sprint.name}: ${formatDue(sprint.start, null)} t/m ${formatDue(sprint.end, null)}`,
    issues.length
      ? `Issues in milestone ${sprint.name} (${issues.filter((i) => i.state === "closed").length}/${issues.length} closed):\n${issues
          .map((i) => `- [${i.state === "closed" ? "af" : "open"}] ${i.title}${i.mine ? " (Piet)" : ""}${i.labels.length ? ` {${i.labels.join(", ")}}` : ""}`)
          .join("\n")}`
      : "No GitLab issues linked to this milestone.",
    mrs.length ? `Merged merge requests:\n${mrs.map((m) => `- ${m.title}${m.mine ? " (Piet)" : ""}`).join("\n")}` : "",
    `Commits in the sprint: ${commits.length} total, ${own.length} by Piet.${own.length ? `\nPiet's commits:\n${own.slice(0, MAX_COMMITS).map((c) => `- ${c.title}`).join("\n")}` : ""}`,
    moments.length ? `In Piet's agenda: ${moments.map((e) => `${e.title} (${formatDue(dayKey(new Date(e.startsAt)), e.allDay ? null : timeKey(new Date(e.startsAt)))})`).join("; ")}` : "",
    inSprint.length ? `Piet's Portflow evidence from this sprint: ${inSprint.map((e) => e.name).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The draft as Markdown, plus the file name for Telegram. */
export async function draftSprintDoc(kind: SprintDocKind, sprint: Sprint, notes: string) {
  const [assignment] = await db
    .select({ description: roadmapItems.description })
    .from(roadmapItems)
    .where(and(eq(roadmapItems.title, ASSIGNMENT[kind]), inArray(roadmapItems.kind, ["assignment", "side"])));
  const facts = await sprintFacts(sprint, kind);

  const response = await anthropic.messages.create({
    model: DEEP_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low" },
    system: `You help Piet, an HBO-ICT propedeuse student (HvA), write the ${ASSIGNMENT[kind]} document for his team's sprint. Write in ${CONTENT_LANGUAGE}, in Markdown, following the template from the assignment exactly (same headings). Fill in only what the facts and Piet's notes support; translate issue and commit titles into readable results, grouped by feature. Where something only the team knows is needed (who attended, stakeholder feedback, the sprint goal if it isn't clear, agreements), write [aanvullen: <wat precies>]. Use "wij"/"jullie" like the template; in "Eigen bijdrage" describe what Piet did based on his own commits, issues and MRs. Output only the document.`,
    messages: [
      {
        role: "user",
        content: `Assignment (with template and quality criteria):\n${assignment?.description ?? `(not found in the roadmap; use the usual ${ASSIGNMENT[kind]} structure)`}\n\nFacts from GitLab, agenda and Portflow:\n${facts}${notes ? `\n\nPiet's notes:\n${notes}` : ""}`,
      },
    ],
  });
  console.log(`[tokens] sprint ${kind} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);
  const markdown = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
    .replace(/^```(?:markdown)?\n([\s\S]*)\n```$/, "$1");
  const todo = (markdown.match(/\[aanvullen:/g) ?? []).length;
  return { markdown, todo, fileName: `${ASSIGNMENT[kind]} ${sprint.name.toLowerCase()}.md` };
}

export const SPRINT_DOC_LABEL = ASSIGNMENT;
