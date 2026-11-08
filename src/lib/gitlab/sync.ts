import { eq, ilike, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, gitlabItems, gitlabProjects } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import { GITLAB_HISTORY_DAYS } from "@/lib/config";
import {
  gitlabGet,
  gitlabList,
  isGitLabConfigured,
  projectPath,
  type GitLabCommit,
  type GitLabIssue,
  type GitLabMergeRequest,
  type GitLabMilestone,
  type GitLabProject,
  type GitLabUser,
} from "./client";

const IDENTITY_KEY = "gitlab_identity";
// Re-fetch a little before the last sync, so an item updated during that sync isn't missed.
const OVERLAP_MS = 60 * 60_000;
const INSERT_CHUNK = 500;

type Identity = { username: string; names: string[]; emails: string[] };
type NewItem = typeof gitlabItems.$inferInsert;

const state = ((globalThis as unknown as { __gitlab?: { running: boolean } }).__gitlab ??= { running: false });

/**
 * Who Piet is on GitLab, to mark his own commits, MRs and issues. Commits are
 * matched on name or e-mail, because a commit's author is whatever his local
 * git config says (GITLAB_AUTHOR_ALIASES adds extra names/e-mails, comma-separated).
 */
async function identity(): Promise<Identity> {
  const cached = await getSetting<Identity>(IDENTITY_KEY);
  if (cached) return cached;
  const user = await gitlabGet<GitLabUser>("/user");
  const extra = await gitlabList<{ email: string }>("/user/emails").catch(() => []);
  const aliases = (process.env.GITLAB_AUTHOR_ALIASES ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  const lower = (list: (string | undefined)[]) => [...new Set(list.filter(Boolean).map((v) => v!.toLowerCase()))];
  const found: Identity = {
    username: user.username,
    names: lower([user.name, user.username, ...aliases.filter((a) => !a.includes("@"))]),
    emails: lower([user.email, user.public_email, user.commit_email, ...extra.map((e) => e.email), ...aliases.filter((a) => a.includes("@"))]),
  };
  await setSetting(IDENTITY_KEY, found);
  return found;
}

/** Projects Piet is a member of, most recently active first (for picking in Settings). */
export async function listAvailableProjects() {
  const projects = await gitlabList<GitLabProject>("/projects", {
    membership: true,
    archived: false,
    order_by: "last_activity_at",
    simple: true,
  });
  return projects.map((p) => ({ gitlabId: p.id, name: p.name, path: p.path_with_namespace, webUrl: p.web_url, lastActivityAt: p.last_activity_at }));
}

export async function listTrackedProjects() {
  return db.select().from(gitlabProjects).orderBy(gitlabProjects.name);
}

/** Start following a project; links it to the folder with the same name if there is one. */
export async function trackProject(gitlabId: number, kind: "project" | "school") {
  const p = await gitlabGet<GitLabProject>(projectPath(gitlabId, ""));
  const [folder] = await db.select({ id: agents.id }).from(agents).where(ilike(agents.name, p.name)).limit(1);
  const [row] = await db
    .insert(gitlabProjects)
    .values({ gitlabId, name: p.name, path: p.path_with_namespace, webUrl: p.web_url, kind, agentId: folder?.id ?? null })
    .onConflictDoUpdate({ target: gitlabProjects.gitlabId, set: { kind } })
    .returning();
  await syncProject(row);
  return row;
}

export async function untrackProject(gitlabId: number) {
  await db.delete(gitlabProjects).where(eq(gitlabProjects.gitlabId, gitlabId));
}

async function upsertItems(items: NewItem[]) {
  for (let i = 0; i < items.length; i += INSERT_CHUNK) {
    await db
      .insert(gitlabItems)
      .values(items.slice(i, i + INSERT_CHUNK))
      .onConflictDoUpdate({
        target: [gitlabItems.projectId, gitlabItems.type, gitlabItems.externalId],
        set: {
          title: sql`excluded.title`,
          state: sql`excluded.state`,
          mine: sql`excluded.mine`,
          labels: sql`excluded.labels`,
          milestone: sql`excluded.milestone`,
          closedAt: sql`excluded.closed_at`,
          dueOn: sql`excluded.due_on`,
          startOn: sql`excluded.start_on`,
        },
      });
  }
}

/** One project: what changed since the last sync (the first time: all issues/MRs and GITLAB_HISTORY_DAYS of commits). */
async function syncProject(project: typeof gitlabProjects.$inferSelect) {
  const me = await identity();
  const startedAt = new Date();
  const since = project.lastSyncedAt
    ? new Date(project.lastSyncedAt.getTime() - OVERLAP_MS)
    : new Date(Date.now() - GITLAB_HISTORY_DAYS * 86_400_000);
  const updatedAfter = project.lastSyncedAt ? since.toISOString() : undefined;
  const isMe = (person?: { username: string } | null) => person?.username === me.username;
  const path = (rest: string) => projectPath(project.gitlabId, rest);

  try {
    const [commits, mrs, issues, milestones] = await Promise.all([
      // all: feature branches count too; a commit on several branches has one sha.
      gitlabList<GitLabCommit>(path("/repository/commits"), { since: since.toISOString(), all: true }),
      gitlabList<GitLabMergeRequest>(path("/merge_requests"), { scope: "all", updated_after: updatedAfter }),
      gitlabList<GitLabIssue>(path("/issues"), { scope: "all", updated_after: updatedAfter }),
      // Few and they change without the issues changing: always all of them. Group
      // milestones are included. GitLab rejects include_ancestors together with the
      // old include_parent_milestones, so only the current one is sent.
      gitlabList<GitLabMilestone>(path("/milestones"), { include_ancestors: true }),
    ]);

    const base = { projectId: project.id };
    await upsertItems([
      ...commits.map((c): NewItem => ({
        ...base,
        type: "commit",
        externalId: c.id,
        title: c.title,
        author: c.author_name,
        mine: me.names.includes(c.author_name.toLowerCase()) || me.emails.includes(c.author_email.toLowerCase()),
        url: c.web_url,
        happenedAt: new Date(c.authored_date),
      })),
      ...mrs.map((m): NewItem => ({
        ...base,
        type: "mr",
        externalId: String(m.iid),
        title: m.title,
        state: m.state,
        author: m.author.username,
        mine: isMe(m.author) || (m.assignees ?? []).some(isMe),
        url: m.web_url,
        labels: m.labels,
        milestone: m.milestone?.title ?? null,
        happenedAt: new Date(m.created_at),
        closedAt: m.merged_at ? new Date(m.merged_at) : m.closed_at ? new Date(m.closed_at) : null,
      })),
      ...issues.map((i): NewItem => ({
        ...base,
        type: "issue",
        externalId: String(i.iid),
        title: i.title,
        state: i.state,
        author: i.author.username,
        // Assigned to Piet; unassigned issues he opened himself count too.
        mine: (i.assignees ?? []).some(isMe) || (!i.assignees?.length && isMe(i.author)),
        url: i.web_url,
        labels: i.labels,
        milestone: i.milestone?.title ?? null,
        happenedAt: new Date(i.created_at),
        closedAt: i.closed_at ? new Date(i.closed_at) : null,
        dueOn: i.due_date,
      })),
      ...milestones.map((m): NewItem => ({
        ...base,
        type: "milestone",
        externalId: String(m.id),
        title: m.title,
        state: m.state,
        url: m.web_url,
        happenedAt: new Date(m.created_at),
        dueOn: m.due_date,
        startOn: m.start_date,
      })),
    ]);
    await db.update(gitlabProjects).set({ lastSyncedAt: startedAt, lastError: null }).where(eq(gitlabProjects.id, project.id));
    return commits.length + mrs.length + issues.length;
  } catch (err) {
    console.error(`[gitlab] sync of ${project.path} failed`, err);
    const message = err instanceof Error ? err.message : String(err);
    await db.update(gitlabProjects).set({ lastError: message }).where(eq(gitlabProjects.id, project.id));
    return 0;
  }
}

/** Every followed project. Errors end up per project (lastError), never thrown, so a cron run can't crash. */
export async function syncGitLab() {
  if (!isGitLabConfigured() || state.running) return { synced: 0 };
  state.running = true;
  try {
    let changed = 0;
    for (const project of await listTrackedProjects()) changed += await syncProject(project);
    return { synced: changed };
  } catch (err) {
    console.error("[gitlab] sync failed", err);
    return { synced: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    state.running = false;
  }
}

export async function getGitLabStatus() {
  if (!isGitLabConfigured()) return { configured: false as const };
  const me = await identity().catch((err: Error) => err);
  return {
    configured: true as const,
    username: me instanceof Error ? null : me.username,
    error: me instanceof Error ? me.message : null,
    tracked: await listTrackedProjects(),
  };
}
