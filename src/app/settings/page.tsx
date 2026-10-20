"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarFeeds } from "@/components/settings/calendar-feeds";
import { ICloudCard, TickTickCard } from "@/components/settings/integrations";

type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
};

export default function SettingsPage() {
  const [google, setGoogle] = useState<GoogleStatus | null>(null);

  async function load() {
    const res = await fetch("/api/google/status");
    setGoogle(await res.json());
  }

  useEffect(() => {
    let ignore = false;
    fetch("/api/google/status")
      .then((res) => res.json())
      .then((data) => {
        if (!ignore) setGoogle(data);
      });

    // Result of an OAuth round trip, passed back by /api/google/callback or /api/ticktick/callback.
    const params = new URLSearchParams(window.location.search);
    for (const [key, label] of [
      ["google", "Google"],
      ["ticktick", "TickTick"],
    ]) {
      const result = params.get(key);
      if (!result) continue;
      if (result === "connected") toast.success(`${label} connected`);
      else toast.error(`${label} connect failed: ${result}`);
      window.history.replaceState(null, "", "/settings");
    }
    return () => {
      ignore = true;
    };
  }, []);

  async function disconnect() {
    await fetch("/api/google/status", { method: "DELETE" });
    toast.success("Google disconnected");
    load();
  }

  return (
    <div className="max-w-2xl w-full mx-auto px-4 py-8 flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Google
            {google?.connected && <Badge variant="secondary">Connected</Badge>}
          </CardTitle>
          <CardDescription>
            Read access to all of your Drive, so the assistant can search and read your files. The app
            only writes inside its own <code>/PietBrain</code> folder.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {!google && <p className="text-muted-foreground">Loading…</p>}
          {google && !google.configured && (
            <p className="text-muted-foreground">
              Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to{" "}
              <code>.env.local</code> and restart the app.
            </p>
          )}
          {google?.connected && (
            <p className="text-muted-foreground">
              Connected as <span className="text-foreground">{google.email ?? "unknown account"}</span>
              {google.connectedAt && ` since ${new Date(google.connectedAt).toLocaleDateString()}`}.
            </p>
          )}
          {google?.configured && !google.connected && (
            <p className="text-muted-foreground">Not connected yet.</p>
          )}
        </CardContent>
        {google?.configured && (
          <CardFooter className="gap-2 justify-end">
            {google.connected && (
              <Button variant="ghost" onClick={disconnect}>
                Disconnect
              </Button>
            )}
            <Button nativeButton={false} render={<a href="/api/google/connect" />}>
              {google.connected ? "Reconnect" : "Connect Google"}
            </Button>
          </CardFooter>
        )}
      </Card>

      <TickTickCard />
      <ICloudCard />
      <CalendarFeeds />
    </div>
  );
}
