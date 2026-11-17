"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Planning, PlanningSprint, PlanningWeek } from "@/lib/school/planning";

// Review, evaluation and test moments, highlighted wherever the planning names them.
const MOMENTS: { label: string; re: RegExp; className: string }[] = [
  { label: "Technische review", re: /technische review/i, className: "bg-green-100 text-green-800" },
  { label: "Sprint review", re: /sprint ?review/i, className: "bg-blue-100 text-blue-800" },
  { label: "Retrospective", re: /retro/i, className: "bg-violet-100 text-violet-800" },
  { label: "Coachingsreview", re: /coachings? ?review/i, className: "bg-amber-100 text-amber-800" },
  { label: "Voortgangsevaluatie", re: /voortgangsevaluatie|zelfevaluatie/i, className: "bg-red-100 text-red-800" },
  { label: "Kennismeting", re: /kennismeting/i, className: "bg-red-100 text-red-800" },
  { label: "Dragons Den", re: /dragons? ?den/i, className: "bg-orange-100 text-orange-800" },
  { label: "Deadline", re: /deadline|opleveren/i, className: "bg-red-100 text-red-800" },
];

const RAIL: Record<string, string> = { ONBOARDEN: "bg-sky-600", AFWIJKEND: "bg-zinc-400" };
const railColor = (rail: string) => RAIL[rail] ?? (rail.startsWith("SPRINT") ? "bg-violet-600" : "bg-zinc-300");

const fmt = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00`).toLocaleDateString("nl-NL", opts);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const today = () => new Date().toLocaleDateString("sv-SE");

function weekMoments(w: PlanningWeek) {
  const text = [w.theme, w.project, ...w.slots.flatMap((s) => s.items.map((i) => i.text))].join(" · ");
  return MOMENTS.filter((m) => m.re.test(text));
}

function Week({ w, current }: { w: PlanningWeek; current: boolean }) {
  const moments = weekMoments(w);
  const empty = w.slots.length === 0 && !w.theme && !w.project;
  return (
    <article
      id={current ? "this-week" : undefined}
      className={cn("rounded-xl bg-white ring-1 p-4 flex flex-col gap-3 scroll-mt-4", current ? "ring-2 ring-blue-500 shadow-md" : "ring-zinc-200", empty && "opacity-60")}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold text-white", railColor(w.rail), w.decision && "bg-red-600")}>
          {w.rail || "Vrij"}
          {w.decision && " · beslissing"}
        </span>
        <span className="text-sm font-medium">
          {fmt(w.date, { day: "numeric", month: "short" })} – {fmt(addDays(w.date, 6), { day: "numeric", month: "short" })}
        </span>
        {current && <span className="text-xs font-semibold text-blue-600">deze week</span>}
        <span className="ml-auto flex flex-wrap gap-1">
          {moments.map((m) => (
            <span key={m.label} className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium", m.className)}>
              {m.label}
            </span>
          ))}
        </span>
      </header>
      {(w.project || w.theme) && (
        <p className="text-sm">
          {w.project && <span className="font-semibold">{w.project}</span>}
          {w.project && w.theme && " · "}
          {w.theme && <span className="text-zinc-600">{w.theme}</span>}
        </p>
      )}
      {w.slots.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {w.slots.map((s) => (
            <div key={s.label} className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-zinc-500">{s.label}</span>
              <ul className="flex flex-col gap-1 text-sm">
                {s.items.map((i) => (
                  <li key={i.text} className="flex items-start gap-1.5">
                    <span className="min-w-0">{i.text}</span>
                    {i.links.map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer" className="mt-0.5 shrink-0 text-blue-600 hover:text-blue-800" aria-label={`Link bij ${i.text}`}>
                        <ExternalLink className="size-3.5" />
                      </a>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export function SchoolPlanning() {
  const [data, setData] = useState<{ planning: Planning | null; sprints: PlanningSprint[] } | null>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    fetch("/api/school/planning")
      .then((res) => (res.ok ? res.json() : { planning: null, sprints: [] }))
      .then(setData)
      .catch(() => setData({ planning: null, sprints: [] }));
  }, []);

  useEffect(() => {
    if (!data?.planning || scrolled.current) return;
    scrolled.current = true;
    document.getElementById("this-week")?.scrollIntoView({ block: "start" });
  }, [data]);

  if (!data) return <p className="p-6 text-sm text-muted-foreground">Planning laden…</p>;
  if (!data.planning) return <p className="p-6 text-sm text-muted-foreground">De HvA-planning is nu niet bereikbaar en er is nog geen kopie.</p>;

  const now = today();
  const { weeks } = data.planning;
  const upcoming = weeks.filter((w) => addDays(w.date, 6) >= now).flatMap((w) => weekMoments(w).map((m) => ({ week: w, m }))).slice(0, 8);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Planning · {data.planning.label}</h1>
        <p className="text-sm text-zinc-600">
          Uit de HvA Onderwijsplanning, bijgewerkt {fmt(data.planning.fetchedAt.slice(0, 10), { day: "numeric", month: "long" })}.
        </p>
      </header>

      <section className="rounded-xl bg-white ring-1 ring-zinc-200 p-4 flex flex-col gap-3">
        <h2 className="font-semibold">Sprints</h2>
        <div className="flex flex-wrap gap-2">
          {data.sprints.map((s) => {
            const running = now >= s.start && now <= s.end;
            return (
              <span key={s.number} className={cn("rounded-lg px-3 py-1.5 text-sm ring-1", running ? "bg-violet-600 text-white ring-violet-600" : now > s.end ? "bg-zinc-100 text-zinc-500 ring-zinc-200" : "bg-white ring-zinc-300")}>
                <span className="font-medium">{s.name}</span> {fmt(s.start, { day: "numeric", month: "short" })} – {fmt(s.end, { day: "numeric", month: "short" })}
              </span>
            );
          })}
        </div>
        {upcoming.length > 0 && (
          <>
            <h2 className="font-semibold mt-1">Komende reviews en toetsmomenten</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {upcoming.map(({ week, m }) => (
                <li key={`${week.date}-${m.label}`} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-zinc-500">week {fmt(week.date, { day: "numeric", month: "short" })}</span>
                  <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium", m.className)}>{m.label}</span>
                  <span className="text-zinc-500">{week.rail}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="flex flex-col gap-3">
        {weeks.map((w) => (
          <Week key={w.date} w={w} current={now >= w.date && now <= addDays(w.date, 6)} />
        ))}
      </div>
    </div>
  );
}
