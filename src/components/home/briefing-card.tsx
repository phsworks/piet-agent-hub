"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { RefreshCw, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SimpleText } from "@/components/files/file-list";
import { cn } from "@/lib/utils";
import { FloatingCard } from "./shared";

type Briefing = { date: string; message: string; createdAt: string };

/** The Brain's "today this matters" message. */
export function BriefingCard() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  async function load(regenerate = false) {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/briefing", { method: regenerate ? "POST" : "GET" });
      if (!res.ok) throw new Error(await res.text());
      setBriefing(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let ignore = false;
    fetch("/api/briefing")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: Briefing) => !ignore && setBriefing(data))
      .catch(() => !ignore && setError(true))
      .finally(() => !ignore && setLoading(false));
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <FloatingCard
      id="briefing"
      icon={<Sun />}
      title="Today"
      meta={format(new Date(), "EEEE d MMMM")}
      actions={
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => load(true)}
          disabled={loading}
          title="Rewrite today's message"
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
      }
    >
      {loading && !briefing && (
        <p className="text-sm text-muted-foreground animate-pulse">The Brain is writing today&apos;s message…</p>
      )}
      {error && !loading && (
        <p className="text-sm text-muted-foreground">Couldn&apos;t write today&apos;s message. Try the refresh button.</p>
      )}
      {briefing && (
        <SimpleText
          text={briefing.message}
          className={cn("text-sm leading-relaxed text-foreground/90 max-h-64 overflow-y-auto", loading && "opacity-50")}
        />
      )}
    </FloatingCard>
  );
}
