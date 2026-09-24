"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Feed = { id: string; name: string; url: string; lastSyncedAt: string | null; lastError: string | null };

/** iCal subscription links (school schedule from iCloud, later Brightspace). */
export function CalendarFeeds() {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"add" | "sync" | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch("/api/calendar/feeds")
      .then((res) => res.json())
      .then((data) => !ignore && setFeeds(data));
    return () => {
      ignore = true;
    };
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy("add");
    try {
      const res = await fetch("/api/calendar/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || "School schedule", url }),
      });
      if (!res.ok) throw new Error(await res.text());
      const feed = (await res.json()) as Feed;
      setFeeds((prev) => [...(prev ?? []), feed]);
      setName("");
      setUrl("");
      if (feed.lastError) toast.error(`Added, but syncing failed: ${feed.lastError}`);
      else toast.success("Calendar added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add the calendar");
    } finally {
      setBusy(null);
    }
  }

  async function syncAll() {
    setBusy("sync");
    const res = await fetch("/api/calendar/sync", { method: "POST" });
    setFeeds(await res.json());
    setBusy(null);
  }

  async function remove(id: string) {
    await fetch(`/api/calendar/feeds/${id}`, { method: "DELETE" });
    setFeeds((prev) => prev?.filter((f) => f.id !== id) ?? null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calendars</CardTitle>
        <CardDescription>
          iCal subscription links, shown in the Agenda on the home screen and readable by agents. For iCloud:
          Calendar → share the calendar → Public calendar → copy the <code>webcal://</code> link. Synced every few
          hours.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {feeds && feeds.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {feeds.map((f) => (
              <li key={f.id} className="flex items-center gap-2 py-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{f.name}</div>
                  <div className={cn("text-xs text-muted-foreground truncate", f.lastError && "text-destructive")}>
                    {f.lastError
                      ? `Sync failed: ${f.lastError}`
                      : f.lastSyncedAt
                        ? `Synced ${new Date(f.lastSyncedAt).toLocaleString()}`
                        : "Not synced yet"}
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => remove(f.id)} title="Remove">
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="School schedule"
            className="sm:w-40"
            aria-label="Name"
          />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="webcal://… or https://…ics"
            className="flex-1"
            aria-label="iCal link"
            required
          />
          <Button type="submit" disabled={!url.trim() || busy !== null}>
            {busy === "add" ? "Adding…" : "Add"}
          </Button>
        </form>
        {feeds && feeds.length > 0 && (
          <Button variant="ghost" size="sm" className="self-end" onClick={syncAll} disabled={busy !== null}>
            <RefreshCw className={cn(busy === "sync" && "animate-spin")} />
            Sync now
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
