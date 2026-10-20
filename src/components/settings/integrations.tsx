"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

type TickTickStatus = {
  configured: boolean;
  connected: boolean;
  connectedAt: string | null;
  expiresAt: string | null;
  lists: string[];
  error?: string;
};

type ICloudStatus = {
  configured: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  calendars: string[];
};

async function fetchJson<T>(url: string) {
  const res = await fetch(url);
  return (await res.json()) as T;
}

export function TickTickCard() {
  const [status, setStatus] = useState<TickTickStatus | null>(null);

  const load = useCallback(() => fetchJson<TickTickStatus>("/api/ticktick/status").then(setStatus), []);

  useEffect(() => {
    let ignore = false;
    fetchJson<TickTickStatus>("/api/ticktick/status").then((data) => {
      if (!ignore) setStatus(data);
    });
    return () => {
      ignore = true;
    };
  }, []);

  async function disconnect() {
    await fetch("/api/ticktick/status", { method: "DELETE" });
    toast.success("TickTick disconnected");
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          TickTick
          {status?.connected && !status.error && <Badge variant="secondary">Connected</Badge>}
        </CardTitle>
        <CardDescription>
          Tasks and reminders. The assistant and <code>/t</code> in Telegram create tasks here; TickTick sends the
          notifications to your phone.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground flex flex-col gap-1">
        {!status && <p>Loading…</p>}
        {status && !status.configured && (
          <p>
            Add <code>TICKTICK_CLIENT_ID</code> and <code>TICKTICK_CLIENT_SECRET</code> to <code>.env.local</code> and
            restart the app.
          </p>
        )}
        {status?.configured && !status.connected && <p>Not connected yet.</p>}
        {status?.error && <p className="text-destructive">{status.error}</p>}
        {status?.connected && !status.error && (
          <>
            <p>
              Lists: <span className="text-foreground">{status.lists.join(", ")}</span>
            </p>
            {status.expiresAt && <p>Connection valid until {new Date(status.expiresAt).toLocaleDateString()}.</p>}
          </>
        )}
      </CardContent>
      {status?.configured && (
        <CardFooter className="gap-2 justify-end">
          {status.connected && (
            <Button variant="ghost" onClick={disconnect}>
              Disconnect
            </Button>
          )}
          <Button nativeButton={false} render={<a href="/api/ticktick/connect" />}>
            {status.connected ? "Reconnect" : "Connect TickTick"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

export function ICloudCard() {
  const [status, setStatus] = useState<ICloudStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => fetchJson<ICloudStatus>("/api/icloud").then(setStatus), []);

  useEffect(() => {
    let ignore = false;
    fetchJson<ICloudStatus>("/api/icloud").then((data) => {
      if (!ignore) setStatus(data);
    });
    return () => {
      ignore = true;
    };
  }, []);

  async function sync() {
    setSyncing(true);
    const res = await fetch("/api/icloud", { method: "POST" });
    const result = (await res.json()) as { synced: number; error?: string };
    setSyncing(false);
    if (result.error) toast.error(result.error);
    else toast.success(`Synced ${result.synced} calendars`);
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          iCloud Calendar
          {status?.configured && !status.lastError && status.calendars.length > 0 && (
            <Badge variant="secondary">Connected</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Read every 15 minutes. The assistant plans sport in <code>Sport</code> and everything else in{" "}
          <code>Coach</code>, so it shows up in any calendar app that uses iCloud.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground flex flex-col gap-1">
        {!status && <p>Loading…</p>}
        {status && !status.configured && (
          <p>
            Add <code>ICLOUD_USERNAME</code> and an app-specific password as <code>ICLOUD_APP_PASSWORD</code> to{" "}
            <code>.env.local</code> and restart the app.
          </p>
        )}
        {status?.lastError && <p className="text-destructive">{status.lastError}</p>}
        {status?.configured && status.calendars.length > 0 && (
          <p>
            Calendars: <span className="text-foreground">{status.calendars.join(", ")}</span>
          </p>
        )}
        {status?.lastSyncedAt && <p>Last synced {new Date(status.lastSyncedAt).toLocaleString()}.</p>}
      </CardContent>
      {status?.configured && (
        <CardFooter className="justify-end">
          <Button variant="secondary" onClick={sync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
