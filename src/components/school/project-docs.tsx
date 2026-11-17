"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, CircleDot, ExternalLink, GitPullRequestArrow, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocItem, ProjectOverview } from "@/lib/school/project";
import { docsPrompt } from "@/lib/school/prompt";
import { PromptButton, relative } from "./portflow-ui";
import { Generator } from "./generator";

const STATE = {
  have: { label: "Staat erin", dot: "bg-emerald-500" },
  todo: { label: "Moet erbij", dot: "bg-zinc-300" },
  extra: { label: "Extra pagina", dot: "bg-sky-400" },
} as const;

function MiniPage({ item, docsUrl }: { item: DocItem; docsUrl: string }) {
  const todo = item.state === "todo";
  const missing = item.checks.filter((c) => !c.ok).length;
  return (
    <article className={cn("rounded-xl ring-1 p-6 flex flex-col gap-5", todo ? "bg-zinc-100 ring-zinc-300 ring-dashed" : "bg-white ring-zinc-200")}>
      <header className="flex flex-col gap-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
          <span className={cn("size-2 rounded-full", STATE[item.state].dot)} /> {STATE[item.state].label}
          {!todo && missing > 0 && ` · ${missing} onderdeel${missing === 1 ? "" : "en"} mist`}
        </span>
        <div className="flex items-start gap-2">
          <h2 className={cn("text-2xl font-semibold mr-auto", todo && "text-zinc-500")}>{item.title}</h2>
          <PromptButton prompt={() => docsPrompt(item, docsUrl)} />
        </div>
        {item.what && <p className="text-zinc-600">{item.what}</p>}
      </header>

      {item.checks.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{todo ? "Wat erin moet" : "Verwachte onderdelen"}</h3>
          <ul className="grid gap-1.5 sm:grid-cols-2 text-sm">
            {item.checks.map((c) => (
              <li key={c.title} className={cn("flex items-center gap-2", c.ok ? "text-zinc-800" : "text-zinc-500")}>
                {c.ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-zinc-400" />}
                {c.title}
                {!c.ok && !todo && <span className="text-[11px] text-amber-700">toevoegen</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {item.pages.map((p) => (
        <section key={p.location} className="flex flex-col gap-2 border-t border-zinc-200 pt-4">
          <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-blue-600 hover:underline">
            {p.title} <ExternalLink className="size-3.5" />
          </a>
          {p.sections.length > 0 && (
            <ol className="flex flex-col gap-2 text-sm">
              {p.sections.map((s, i) => (
                <li key={`${s.title}-${i}`}>
                  <span className="font-medium">{s.title}</span>
                  {s.excerpt && <p className="text-zinc-600 line-clamp-2">{s.excerpt}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}

      {todo && <p className="text-sm text-zinc-500">Deze pagina bestaat nog niet op de docs-site. Laat hem hieronder maken en zet de .md in docs/ van de repo.</p>}

      <Generator
        key={item.id}
        genKey={`docs:${item.id}`}
        kind="docs"
        title={item.title}
        hint={`${item.title} ${item.what} ${item.checks.map((c) => c.title).join(" ")} ${item.pages.map((p) => p.location).join(" ")}`}
        initialPrompt={docsPrompt(item, docsUrl)}
      />
    </article>
  );
}

function Issues({ data }: { data: ProjectOverview }) {
  if (data.issues.length === 0) {
    return <p className="text-sm text-zinc-500">Nog geen issues: koppel het Kova-project als school-project in Instellingen › GitLab.</p>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {data.issues.map((s) => {
        const closed = s.issues.filter((i) => i.state === "closed").length;
        return (
          <section key={s.milestone} className="rounded-xl bg-white ring-1 ring-zinc-200 overflow-hidden">
            <header className="flex items-center gap-2 bg-[#3f4752] px-4 py-2.5 text-white">
              <GitPullRequestArrow className="size-4" />
              <h3 className="font-semibold">{s.milestone}</h3>
              <span className="ml-auto text-xs text-white/70">{closed}/{s.issues.length} klaar</span>
            </header>
            <ul className="divide-y divide-zinc-100 text-sm">
              {s.issues.map((i) => (
                <li key={`${i.project}-${i.id}`} className="flex items-start gap-2 px-4 py-2">
                  {i.state === "closed" ? <CheckCircle2 className="size-4 mt-0.5 shrink-0 text-emerald-600" /> : <CircleDot className="size-4 mt-0.5 shrink-0 text-zinc-400" />}
                  <a href={i.url ?? "#"} target="_blank" rel="noreferrer" className={cn("min-w-0 flex-1 hover:underline", i.state === "closed" && "text-zinc-500")}>
                    #{i.id} {i.title}
                  </a>
                  {i.mine && <span className="shrink-0 rounded bg-blue-50 px-1.5 text-[11px] text-blue-700">jij</span>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** The team's docs site rebuilt as mini pages: what is there and what still has to come. */
export function ProjectDocs() {
  const [data, setData] = useState<ProjectOverview | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/school/project")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  async function toggle(id: string, done: boolean) {
    setData((d) => d && { ...d, checks: d.checks.map((c) => (c.id === id ? { ...c, done } : c)) });
    await fetch("/api/school/project", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, done }) });
  }

  if (!data) return <p className="p-6 text-sm text-muted-foreground">{error ? "Laden mislukt." : "Laden…"}</p>;
  const items = data.groups.flatMap((g) => g.items);
  const current = items.find((i) => i.id === selected) ?? items[0];
  const have = items.filter((i) => i.state === "have").length;
  const todo = items.filter((i) => i.state === "todo").length;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-3xl font-semibold">Kova · documentatie</h1>
          <p className="text-sm text-zinc-600">
            {have} pagina&apos;s staan erin · {todo} moeten erbij{data.fetchedAt && ` · bijgewerkt ${relative(data.fetchedAt)}`}
          </p>
        </div>
        <a href={data.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
          Open de docs-site <ExternalLink className="size-3.5" />
        </a>
      </header>

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <nav className="flex flex-col gap-4 md:sticky md:top-4 md:self-start md:max-h-[85vh] md:overflow-y-auto">
          {data.groups.map((g) => (
            <div key={g.group} className="flex flex-col gap-0.5">
              <span className="px-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{g.group}</span>
              {g.items.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => setSelected(i.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-zinc-100",
                    i.id === current?.id && "bg-zinc-100 font-medium",
                    i.state === "todo" && "text-zinc-500",
                  )}
                >
                  {i.state === "todo" ? <Plus className="size-3.5 shrink-0" /> : <span className={cn("size-2 shrink-0 rounded-full", STATE[i.state].dot)} />}
                  <span className="truncate">{i.title}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        {current ? <MiniPage item={current} docsUrl={data.docsUrl} /> : <p className="text-sm text-zinc-500">De docs-site is niet bereikbaar.</p>}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Issues per sprint</h2>
        <Issues data={data} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Project-checklist</h2>
        <ul className="rounded-xl bg-white ring-1 ring-zinc-200 divide-y divide-zinc-100">
          {data.checks.map((c) => (
            <li key={c.id}>
              <label className="flex items-start gap-3 px-4 py-2.5 text-sm cursor-pointer">
                <input type="checkbox" checked={c.done} onChange={(e) => toggle(c.id, e.target.checked)} className="mt-0.5 size-4 accent-emerald-600" />
                <span className={cn(c.done && "text-zinc-400 line-through")}>{c.title}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
