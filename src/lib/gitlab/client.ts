import { GITLAB_DEFAULT_URL } from "@/lib/config";

// GitLab REST API v4 with a personal access token (scope read_api). One user
// and no callback URL, so a token is simpler than OAuth and works behind
// Tailscale without public ports.
const PER_PAGE = 100;
// Safety cap per list request: 2,000 items is far more than a student project has.
const MAX_PAGES = 20;

export function isGitLabConfigured() {
  return Boolean(process.env.GITLAB_TOKEN);
}

export function gitlabUrl() {
  return (process.env.GITLAB_URL || GITLAB_DEFAULT_URL).replace(/\/$/, "");
}

export class GitLabNotConfiguredError extends Error {
  constructor() {
    super("GitLab is not connected: set GITLAB_TOKEN (scope read_api) in .env.local / .env.production.");
  }
}

type Query = Record<string, string | number | boolean | undefined>;

function url(path: string, query: Query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  return `${gitlabUrl()}/api/v4${path}${params.size ? `?${params}` : ""}`;
}

async function request(path: string, query?: Query) {
  if (!isGitLabConfigured()) throw new GitLabNotConfiguredError();
  const res = await fetch(url(path, query), { headers: { "PRIVATE-TOKEN": process.env.GITLAB_TOKEN! } });
  if (res.status === 401) throw new Error("GitLab rejected the token (expired or wrong scope?). Make a new one with scope read_api.");
  if (!res.ok) throw new Error(`GitLab ${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

export async function gitlabGet<T>(path: string, query?: Query): Promise<T> {
  return (await (await request(path, query)).json()) as T;
}

export async function gitlabText(path: string, query?: Query): Promise<string> {
  return (await request(path, query)).text();
}

/** Follows GitLab's x-next-page header until the list ends (or MAX_PAGES). */
export async function gitlabList<T>(path: string, query: Query = {}): Promise<T[]> {
  const all: T[] = [];
  let page: string | null = "1";
  for (let i = 0; page && i < MAX_PAGES; i++) {
    const res = await request(path, { ...query, per_page: PER_PAGE, page });
    all.push(...((await res.json()) as T[]));
    page = res.headers.get("x-next-page") || null;
  }
  return all;
}

export const projectPath = (gitlabId: number, rest: string) => `/projects/${gitlabId}${rest}`;

// Only the fields the hub uses.
export type GitLabUser = { id: number; username: string; name: string; email?: string; public_email?: string; commit_email?: string };
export type GitLabProject = {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
  last_activity_at: string;
  archived: boolean;
};
export type GitLabCommit = {
  id: string;
  title: string;
  author_name: string;
  author_email: string;
  authored_date: string;
  web_url: string;
};
type Person = { id: number; username: string; name: string };
export type GitLabMergeRequest = {
  iid: number;
  title: string;
  state: "opened" | "closed" | "merged" | "locked";
  author: Person;
  assignees?: Person[];
  web_url: string;
  labels: string[];
  milestone: { title: string } | null;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
};
export type GitLabIssue = {
  iid: number;
  title: string;
  state: "opened" | "closed";
  author: Person;
  assignees?: Person[];
  web_url: string;
  labels: string[];
  milestone: { title: string } | null;
  created_at: string;
  closed_at: string | null;
  due_date: string | null;
};
export type GitLabMilestone = {
  id: number;
  title: string;
  state: "active" | "closed";
  web_url: string;
  created_at: string;
  start_date: string | null;
  due_date: string | null;
};
