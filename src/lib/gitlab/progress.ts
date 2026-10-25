import { and, desc, eq, gte, ilike, isNotNull, lte, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { gitlabItems, gitlabProjects } from "@/lib/db/schema";
import { dayKey } from "@/lib/dates";
import { formatDue } from "@/lib/telegram/quick";

// All in code, no AI: "Kova, laatste 7 dagen: 12 commits (8 van jou), ..."

type Project = typeof gitlabProjects.$inferSelect;
type Item = typeof gitlabItems.$inferSelect;

export type MilestoneProgress = { title: string; dueOn: string | null; done: number; total: number; url: string | null };

export type ProjectProgress = {
  project: Project;
  days: number;
  commits: number;
  ownCommits: number;
  lastOwnCommitAt: Date | null;
  lastCommitAt: Date | null;
  mrsMerged: number;
  mrsOpen: Item[];
  issuesClosed: number;
  ownOpenIssues: Item[];
  milestones: MilestoneProgress[];
};

/** A followed project by (part of) its name or path; null when none or several match. */
export async function findProject(query: string) {
  const q = query.trim();
  const rows = await db
    .select()
    .from(gitlabProjects)
    .where(or(ilike(gitlabProjects.name, `%${q}%`), ilike(gitlabProjects.path, `%${q}%`)));
  return rows.find((r) => r.name.toLowerCase() === q.toLowerCase()) ?? (rows.length === 1 ? rows[0] : null);
}

export async function projectProgress(project: Project, days = 7): Promise<ProjectProgress> {
  const since = new Date(Date.now() - days * 86_400_000);
  const items = await db.select().from(gitlabItems).where(eq(gitlabItems.projectId, project.id));
  const of = (type: string) => items.filter((i) => i.type === type);
  const commits = of("commit").sort((a, b) => b.happenedAt.getTime() - a.happenedAt.getTime());
  const recent = commits.filter((c) => c.happenedAt >= since);
  const issues = of("issue");

  const milestones = of("milestone")
    .filter((m) => m.state === "active")
    .map((m): MilestoneProgress => {
      const linked = issues.filter((i) => i.milestone === m.title);
      return { title: m.title, dueOn: m.dueOn, done: linked.filter((i) => i.state === "closed").length, total: linked.length, url: m.url };
    })
    // The first one due first; undated ones last.
    .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));

  return {
    project,
    days,
    commits: recent.length,
    ownCommits: recent.filter((c) => c.mine).length,
    lastOwnCommitAt: commits.find((c) => c.mine)?.happenedAt ?? null,
    lastCommitAt: commits[0]?.happenedAt ?? null,
    mrsMerged: of("mr").filter((m) => m.state === "merged" && m.closedAt && m.closedAt >= since).length,
    mrsOpen: of("mr").filter((m) => m.state === "opened"),
    issuesClosed: issues.filter((i) => i.state === "closed" && i.closedAt && i.closedAt >= since).length,
    ownOpenIssues: issues
      .filter((i) => i.mine && i.state === "opened")
      .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999")),
    milestones,
  };
}

export async function allProgress(days = 7) {
  const projects = await db.select().from(gitlabProjects).orderBy(gitlabProjects.kind, gitlabProjects.name);
  return Promise.all(projects.map((p) => projectProgress(p, days)));
}

/** "3 dagen geleden", "vandaag" */
export function ago(date: Date | null) {
  if (!date) return "nog nooit";
  const days = Math.round((Date.parse(dayKey()) - Date.parse(dayKey(date))) / 86_400_000);
  return days === 0 ? "vandaag" : days === 1 ? "gisteren" : `${days} dagen geleden`;
}

export const milestoneLine = (m: MilestoneProgress) =>
  `${m.title}: ${m.done}/${m.total} issues af${m.dueOn ? `, deadline ${formatDue(m.dueOn, null)}` : ""}`;

/** One line for the coach's facts and the /project list. */
export function progressSummary(p: ProjectProgress) {
  const parts = [
    `${p.commits} commits${p.commits ? ` (${p.ownCommits} van jou)` : ""}`,
    p.mrsMerged ? `${p.mrsMerged} MR's gemerged` : "",
    p.issuesClosed ? `${p.issuesClosed} issues gesloten` : "",
    `jouw laatste commit ${ago(p.lastOwnCommitAt)}`,
    p.milestones[0] ? milestoneLine(p.milestones[0]) : "",
  ].filter(Boolean);
  return `${p.project.name}: ${parts.join(", ")}`;
}

const MAX_LISTED = 5;

/** The detailed /project <naam> message. */
export function progressDetail(p: ProjectProgress) {
  const lines = [
    `📈 ${p.project.name}, laatste ${p.days} dagen`,
    `- ${p.commits} commits, ${p.ownCommits} van jou (jouw laatste: ${ago(p.lastOwnCommitAt)})`,
    `- ${p.mrsMerged} MR's gemerged, ${p.issuesClosed} issues gesloten`,
  ];
  if (p.milestones.length) lines.push("", "🏁 Milestones", ...p.milestones.map((m) => `- ${milestoneLine(m)}`));
  if (p.ownOpenIssues.length) {
    lines.push(
      "",
      "📌 Jouw open issues",
      ...p.ownOpenIssues.slice(0, MAX_LISTED).map((i) => `- #${i.externalId} ${i.title}${i.dueOn ? ` (${formatDue(i.dueOn, null)})` : ""}`)
    );
    if (p.ownOpenIssues.length > MAX_LISTED) lines.push(`  …en nog ${p.ownOpenIssues.length - MAX_LISTED}`);
  }
  if (p.mrsOpen.length) lines.push("", `🔀 ${p.mrsOpen.length} open MR's: ${p.mrsOpen.slice(0, 3).map((m) => `!${m.externalId} ${m.title}`).join("; ")}`);
  if (p.project.lastError) lines.push("", `⚠️ Laatste sync mislukt: ${p.project.lastError}`);
  lines.push("", p.project.webUrl);
  return lines.join("\n");
}

export type ProjectDeadline = { id: string; project: string; type: "milestone" | "issue"; title: string; dueOn: string; url: string | null };

/**
 * Active milestones and Piet's own open issues with a due date up to untilDay;
 * overdue issues are included (a closed one is never shown).
 */
export async function projectDeadlines(untilDay: string, fromDay = dayKey()): Promise<ProjectDeadline[]> {
  const rows = await db
    .select({ item: gitlabItems, project: gitlabProjects.name })
    .from(gitlabItems)
    .innerJoin(gitlabProjects, eq(gitlabProjects.id, gitlabItems.projectId))
    .where(
      and(
        isNotNull(gitlabItems.dueOn),
        lte(gitlabItems.dueOn, untilDay),
        or(
          and(eq(gitlabItems.type, "milestone"), eq(gitlabItems.state, "active"), gte(gitlabItems.dueOn, fromDay)),
          and(eq(gitlabItems.type, "issue"), eq(gitlabItems.state, "opened"), eq(gitlabItems.mine, true))
        )
      )
    )
    .orderBy(gitlabItems.dueOn);
  return rows.map(({ item, project }) => ({
    id: item.id,
    project,
    type: item.type as "milestone" | "issue",
    title: item.type === "issue" ? `#${item.externalId} ${item.title}` : item.title,
    dueOn: item.dueOn!,
    url: item.url,
  }));
}

/** When Piet last committed anything in a project (for the "nothing pushed in days" nudge). */
export async function lastOwnCommit(projectId: string) {
  const [row] = await db
    .select({ at: gitlabItems.happenedAt })
    .from(gitlabItems)
    .where(and(eq(gitlabItems.projectId, projectId), eq(gitlabItems.type, "commit"), eq(gitlabItems.mine, true)))
    .orderBy(desc(gitlabItems.happenedAt))
    .limit(1);
  return row?.at ?? null;
}
