import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { gitlabItems, gitlabProjects } from "@/lib/db/schema";
import { dayKey } from "@/lib/dates";
import { gitlabGet, gitlabList, gitlabText, projectPath } from "@/lib/gitlab/client";
import { searchMemories } from "@/lib/memory/store";
import { searchFiles } from "@/lib/files/search";
import { getLocalProject } from "./local-project";
import { listEvidence } from "./portflow";

// What the school generator may look at by itself, so Piet only presses
// "Genereer": the whole Kova project (local sync, else GitLab), his notes and
// files in the hub, his GitLab work and his Portflow evidence.

const MAX_FILE_CHARS = 15_000;
const SKIP = /(^|\/)(node_modules|dist|build|\.next|coverage|vendor|site)\/|lock\.json$|\.lock$|\.min\.|tsbuildinfo/i;

export type ProjectSource = { label: string; paths: string[]; read: (path: string) => Promise<string> };

export async function kovaProject() {
  const school = await db.select().from(gitlabProjects).where(eq(gitlabProjects.kind, "school"));
  return school.find((x) => /kova|impact/i.test(`${x.name} ${x.path}`)) ?? (school.length === 1 ? school[0] : null);
}

/** Piet's local project when synced (also unpushed work), else the repo in GitLab, else none. */
export async function projectSource(gitlabId: number | null): Promise<ProjectSource | null> {
  const local = await getLocalProject();
  if (local) {
    return {
      label: `Piet's local project (synced ${local.at}, branch ${local.branch}, last commit ${local.commit}, ${local.changed} uncommitted changes)`,
      paths: Object.keys(local.files).filter((p) => !SKIP.test(p)).sort(),
      read: async (p) => local.files[p] ?? "",
    };
  }
  if (gitlabId === null) return null;
  const project = await gitlabGet<{ default_branch: string }>(projectPath(gitlabId, ""));
  const tree = await gitlabList<{ path: string; type: string }>(projectPath(gitlabId, "/repository/tree"), { recursive: true, ref: project.default_branch });
  return {
    label: `GitLab repository (${project.default_branch})`,
    paths: tree.filter((t) => t.type === "blob" && !SKIP.test(t.path)).map((t) => t.path),
    read: (p) => gitlabText(projectPath(gitlabId, `/repository/files/${encodeURIComponent(p)}/raw`), { ref: project.default_branch }),
  };
}

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_files",
    description: "Read up to 6 files of the Kova project by path (from the file list). Long files are cut at 15,000 characters.",
    input_schema: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, maxItems: 6 } }, required: ["paths"] },
  },
  {
    name: "search_code",
    description: "Find text in all project files (case-insensitive). Returns up to 40 matching lines as path:line: text.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "search_my_notes",
    description: "Search Piet's own notes and uploaded files in the hub: feedback he got, decisions, how he works, earlier texts. Use it for anything only Piet would know.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "my_gitlab_work",
    description: "Piet's own merge requests, commits and issues in the team's GitLab project, with links. Optionally for one sprint.",
    input_schema: { type: "object", properties: { sprint: { type: "integer" } } },
  },
  {
    name: "my_portflow",
    description: "The evidence Piet already has in Portflow (name, date, collection, goals), to match it and avoid duplicates.",
    input_schema: { type: "object", properties: {} },
  },
];

export async function runAgentTool(name: string, input: Record<string, unknown>, ctx: { source: ProjectSource | null; projectId: string | null }) {
  switch (name) {
    case "read_files": {
      if (!ctx.source) return { error: "No project code available." };
      const paths = (Array.isArray(input.paths) ? input.paths : []).filter((p): p is string => typeof p === "string").slice(0, 6);
      return Promise.all(
        paths.map(async (p) => (ctx.source!.paths.includes(p) ? { path: p, content: (await ctx.source!.read(p).catch(() => "")).slice(0, MAX_FILE_CHARS) } : { path: p, error: "not in the file list" })),
      );
    }
    case "search_code": {
      if (!ctx.source) return { error: "No project code available." };
      const q = String(input.query ?? "").toLowerCase();
      if (!q) return { error: "query required" };
      const hits: string[] = [];
      // shortcut: reads every file per search; fine for ~250 local files, slow on a big GitLab repo.
      for (const p of ctx.source.paths) {
        if (hits.length >= 40) break;
        const lines = (await ctx.source.read(p).catch(() => "")).split("\n");
        lines.forEach((l, i) => hits.length < 40 && l.toLowerCase().includes(q) && hits.push(`${p}:${i + 1}: ${l.trim().slice(0, 200)}`));
      }
      return hits.length ? hits : "no matches";
    }
    case "search_my_notes": {
      const q = String(input.query ?? "");
      const [notes, files] = await Promise.all([searchMemories(q, 8), searchFiles(q, { limit: 5 })]);
      return {
        notes: notes.filter((n) => n.similarity > 0.25).map((n) => n.content),
        files: files.map((f) => ({ file: f.file, text: f.content.slice(0, 1500) })),
      };
    }
    case "my_gitlab_work": {
      if (!ctx.projectId) return "No GitLab data: Piet adds links himself.";
      const sprint = typeof input.sprint === "number" ? input.sprint : null;
      const rows = await db
        .select({ type: gitlabItems.type, title: gitlabItems.title, state: gitlabItems.state, url: gitlabItems.url, milestone: gitlabItems.milestone, at: gitlabItems.happenedAt })
        .from(gitlabItems)
        .where(and(eq(gitlabItems.projectId, ctx.projectId), eq(gitlabItems.mine, true), or(eq(gitlabItems.type, "mr"), eq(gitlabItems.type, "commit"), eq(gitlabItems.type, "issue"))))
        .orderBy(desc(gitlabItems.happenedAt))
        .limit(100);
      const keep = sprint === null ? rows : rows.filter((r) => r.type === "commit" || new RegExp(`sprint\\s*${sprint}\\b`, "i").test(r.milestone ?? ""));
      return keep.map((r) => `${r.type} ${dayKey(r.at)} ${r.state ?? ""} "${r.title}" ${r.milestone ?? ""} ${r.url ?? ""}`.replace(/\s+/g, " "));
    }
    case "my_portflow":
      return (await listEvidence()).map((e) => `${e.createdOn} "${e.name}" [${e.collections.join(", ")}] ${e.subgoals.join(", ")}`);
    default:
      return { error: `unknown tool ${name}` };
  }
}
