"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

type Kind = "project" | "school";

type Tracked = { gitlabId: number; name: string; path: string; kind: Kind; lastSyncedAt: string | null; lastError: string | null };
type Available = { gitlabId: number; name: string; path: string; lastActivityAt: string };

type GitLabStatus =
  | { configured: false; available: [] }
  | { configured: true; username: string | null; error: string | null; tracked: Tracked[]; available: Available[] };

// The membership list on HvA GitLab includes every old school project; the rest is behind "Show all".
const COLLAPSED = 8;

async function load() {
  const res = await fetch("/api/gitlab");
  return (await res.json()) as GitLabStatus;
}

async function post(body: object) {
  const res = await fetch("/api/gitlab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as { error?: string; synced?: number; tracked?: string };
}

export function GitLabCard() {
  const [status, setStatus] = useState<GitLabStatus | null>(null);
  const [busy, setBusy] = useState<number | "sync" | null>(null);
  const [showAll, setShowAll] = useState(false);

  const reload = useCallback(() => load().then(setStatus), []);

  useEffect(() => {
    let ignore = false;
    load().then((data) => {
      if (!ignore) setStatus(data);
    });
    return () => {
      ignore = true;
    };
  }, []);

  async function act(key: number | "sync", body: object, success: (r: Awaited<ReturnType<typeof post>>) => string) {
    setBusy(key);
    const result = await post(body);
    setBusy(null);
    if (result.error) toast.error(result.error);
    else toast.success(success(result));
    reload();
  }

  const tracked = status?.configured ? status.tracked : [];
  const trackedIds = new Set(tracked.map((t) => t.gitlabId));
  const untracked = status?.configured ? status.available.filter((p) => !trackedIds.has(p.gitlabId)) : [];
  const shown = showAll ? untracked : untracked.slice(0, COLLAPSED);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          GitLab
          {status?.configured && !status.error && <Badge variant="secondary">{status.username}</Badge>}
        </CardTitle>
        <CardDescription>
          Commits, merge requests, issues and milestones of the projects you follow, synced every 30 minutes. Used by{" "}
          <code>/project</code>, the assistant, the weekly review and deadline nudges.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground flex flex-col gap-3">
        {!status && <p>Loading…</p>}
        {status && !status.configured && (
          <p>
            Make a personal access token (scope <code>read_api</code>) under Preferences › Access tokens, add it as{" "}
            <code>GITLAB_TOKEN</code> to <code>.env.local</code> (and <code>.env.production</code> on the VPS) and restart
            the app. Another instance than HvA&apos;s: set <code>GITLAB_URL</code>.
          </p>
        )}
        {status?.configured && status.error && <p className="text-destructive">{status.error}</p>}

        {tracked.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-foreground font-medium">Following</p>
            {tracked.map((p) => (
              <div key={p.gitlabId} className="flex items-center gap-2 flex-wrap">
                <span className="text-foreground">{p.name}</span>
                <Badge variant="outline">{p.kind}</Badge>
                <span className="text-xs">
                  {p.lastError ? (
                    <span className="text-destructive">{p.lastError}</span>
                  ) : p.lastSyncedAt ? (
                    `synced ${new Date(p.lastSyncedAt).toLocaleString()}`
                  ) : (
                    "not synced yet"
                  )}
                </span>
                <span className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === p.gitlabId}
                    onClick={() =>
                      act(p.gitlabId, { action: "track", gitlabId: p.gitlabId, kind: p.kind === "school" ? "project" : "school" }, () => "Updated")
                    }
                  >
                    {p.kind === "school" ? "Mark as project" : "Mark as school"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === p.gitlabId}
                    onClick={() => act(p.gitlabId, { action: "untrack", gitlabId: p.gitlabId }, () => `Stopped following ${p.name}`)}
                  >
                    Stop
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}

        {untracked.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-foreground font-medium">Your projects</p>
            {shown.map((p) => (
              <div key={p.gitlabId} className="flex items-center gap-2 flex-wrap">
                <span className="text-foreground">{p.name}</span>
                <span className="text-xs truncate">{p.path}</span>
                <span className="ml-auto flex gap-1">
                  {(["project", "school"] as const).map((kind) => (
                    <Button
                      key={kind}
                      size="sm"
                      variant="secondary"
                      disabled={busy === p.gitlabId}
                      onClick={() => act(p.gitlabId, { action: "track", gitlabId: p.gitlabId, kind }, (r) => `Following ${r.tracked}`)}
                    >
                      {busy === p.gitlabId ? "…" : kind === "project" ? "Follow" : "Follow as school"}
                    </Button>
                  ))}
                </span>
              </div>
            ))}
            {untracked.length > COLLAPSED && (
              <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowAll(!showAll)}>
                {showAll ? "Show fewer" : `Show all ${untracked.length}`}
              </Button>
            )}
          </div>
        )}
      </CardContent>
      {status?.configured && tracked.length > 0 && (
        <CardFooter className="justify-end">
          <Button variant="secondary" disabled={busy === "sync"} onClick={() => act("sync", { action: "sync" }, (r) => `Synced (${r.synced} changes)`)}>
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
