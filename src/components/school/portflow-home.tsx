"use client";

import Link from "next/link";
import { AlertTriangle, FolderOpen, Target } from "lucide-react";
import { Row } from "./portflow-collection";
import { EvidenceLine, Loading, UploadButton, relative, useMirror } from "./portflow-ui";

/** Portflow's "Collecties" page: the four collections, each opening its own page. */
export function PortflowHome() {
  const { data, error, load } = useMirror();
  if (!data) return <Loading error={error} />;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold">Collecties</h1>
          <p className="text-sm text-zinc-600">
            {data.sprint ? `Nu ${data.sprint} · ` : ""}
            {data.evidenceCount} bewijzen ingelezen{data.lastImport && ` · laatste screenshot ${relative(data.lastImport)}`}
          </p>
        </div>
        <UploadButton onDone={load} />
      </header>

      <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3.5 rounded bg-white ring-1 ring-zinc-300" /> Heb je al in Portflow
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3.5 rounded bg-zinc-200" /> Moet erbij
        </span>
        <span className="inline-flex items-center gap-1.5 text-amber-700">
          <AlertTriangle className="size-3.5" /> Staat op de verkeerde plek of mist een doel
        </span>
      </div>

      <div className="flex items-center gap-3 text-sm font-semibold">
        <span className="h-px flex-1 bg-zinc-300" />
        ICT Propedeuse - 2026 - 2027 - semester 1 - ICT In Action
        <span className="h-px flex-1 bg-zinc-300" />
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {data.collections.map((c) => {
          const feedbackMissing = c.sections.flatMap((s) => s.rows).filter((r) => r.feedback && r.feedback.found.length === 0).length;
          return (
            <Link key={c.slug} href={`/collectie/${c.slug}`} className="rounded-lg bg-white p-3 ring-1 ring-zinc-200 shadow-sm hover:shadow-md transition-shadow flex items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-md text-white" style={{ background: c.color }}>
                <FolderOpen className="size-4" />
              </span>
              <span className="min-w-0 flex-1 flex flex-col gap-1">
                <span className="text-sm font-semibold">{c.name.replace(/^De /, "de ")}</span>
                <span className="h-1 w-full rounded-full bg-zinc-100 overflow-hidden">
                  <span className="block h-full rounded-full" style={{ width: `${c.total ? (c.have / c.total) * 100 : 0}%`, background: c.color }} />
                </span>
                <span className="text-[11px] text-zinc-500">
                  {c.have}/{c.total}{feedbackMissing > 0 && ` · ${feedbackMissing}× feedback`}
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        {data.collections.map((c) => (
          <section key={c.slug} className="rounded-lg ring-1 ring-zinc-200 overflow-hidden bg-white">
            <Link href={`/collectie/${c.slug}`} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-white" style={{ background: c.color }}>
              <FolderOpen className="size-4" /> {c.name.replace(/^De /, "de ")}
              <span className="ml-auto text-xs font-normal text-white/80">{c.have}/{c.total}</span>
            </Link>
            {c.unlinked.length > 0 && (
              <ul className="divide-y divide-zinc-200">
                {c.unlinked.map((r) => (
                  <Row key={r.key} c={c} goal="geen leerdoel" compact row={{ ...r, evidence: r.evidence.map((e) => ({ ...e, fix: "koppel aan een leerdoel" })) }} />
                ))}
              </ul>
            )}
            {c.sections.filter((s) => s.rows.length > 0).map((s) => (
              <div key={s.goal}>
                <h3 className="flex items-center gap-2 bg-[#3f4752] px-3 py-1.5 text-xs font-semibold text-white">
                  <Target className="size-3.5" /> {s.name}
                </h3>
                <ul className="divide-y divide-zinc-200">
                  {s.rows.map((r) => (
                    <Row key={r.key} c={c} goal={s.name} compact row={r} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>

      {data.noCollection.length > 0 && (
        <section className="rounded-xl bg-white ring-1 ring-zinc-200 p-4 flex flex-col gap-3">
          <h2 className="font-semibold">Zonder collectie</h2>
          {data.noCollection.map((e) => (
            <EvidenceLine key={e.id} e={e} />
          ))}
        </section>
      )}
    </div>
  );
}
