"use client";

import Link from "next/link";
import { CheckCircle2, Circle, MessageSquareText } from "lucide-react";
import { evidencePrompt } from "@/lib/school/prompt";
import { Chip, EvidenceLine, Loading, typeOf, useMirror } from "./portflow-ui";
import { Generator } from "./generator";

/** One evidence row opened on its own, like Portflow's evidence page: what it is and what goes in it. */
export function PortflowEvidence({ slug, rowKey }: { slug: string; rowKey: string }) {
  const { data, error } = useMirror();
  if (!data) return <Loading error={error} />;
  const c = data.collections.find((x) => x.slug === slug);
  const section = c?.sections.find((s) => s.rows.some((r) => r.key === rowKey));
  const row = section?.rows.find((r) => r.key === rowKey);
  if (!c || !section || !row) return <p className="p-6 text-sm">Dit bewijs bestaat niet (meer). <Link href="/" className="text-blue-600">Terug</Link></p>;
  const t = typeOf(row.type);
  const Icon = t.icon;

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-600">
        <Link href="/" className="hover:text-zinc-900">Collecties</Link> /
        <Link href={`/collectie/${slug}`} className="hover:text-zinc-900">{c.name.replace(/^De /, "de ")}</Link> /
        <span className="text-zinc-900">{row.title}</span>
      </nav>

      <div className="rounded-xl bg-white ring-1 ring-zinc-200 p-5 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className={`grid size-10 shrink-0 place-items-center rounded-full ${t.circle}`}>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{row.title}</h1>
            <p className="text-sm text-zinc-600">
              {section.name} · {t.label}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">{row.sub && <Chip>{row.sub}</Chip>}</div>
        <p className="text-[15px] leading-relaxed">{row.what}</p>
      </div>

      <section className="rounded-xl bg-white ring-1 ring-zinc-200 p-5 flex flex-col gap-3">
        <h2 className="font-semibold">Wat moet erin</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {row.content.map((x) => (
            <li key={x} className="flex gap-2">
              <span className="text-zinc-400">•</span> {x}
            </li>
          ))}
        </ul>
      </section>

      <Generator
        key={row.key}
        genKey={`portflow:${row.key}`}
        kind={row.type === "link" ? "link" : "document"}
        title={row.title}
        hint={`${row.title} ${row.what} ${row.content.join(" ")}`}
        initialPrompt={evidencePrompt(row, c.name, section.name)}
      />

      <section className="rounded-xl bg-white ring-1 ring-zinc-200 p-5 flex flex-col gap-3">
        <h2 className="font-semibold">In jouw Portflow</h2>
        {row.evidence.length ? (
          row.evidence.map((e) => <EvidenceLine key={e.id} e={e} />)
        ) : (
          <p className="text-sm text-zinc-500">Nog niets. Voeg het toe als {t.label.toLowerCase()} onder {row.sub ?? section.name}.</p>
        )}
      </section>

      {row.feedback && (
        <section className="rounded-xl bg-pink-50 ring-1 ring-pink-200 p-5 flex flex-col gap-2">
          <h2 className="font-semibold inline-flex items-center gap-2">
            <MessageSquareText className="size-4 text-pink-600" /> Feedback nodig
          </h2>
          <p className="text-sm">Van: {row.feedback.who}.</p>
          {row.feedback.found.length ? (
            row.feedback.found.map((f) => (
              <span key={f.id} className="inline-flex items-center gap-1.5 text-sm text-pink-800">
                <CheckCircle2 className="size-4" /> {f.name}
              </span>
            ))
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm text-pink-700">
              <Circle className="size-4" /> Nog niet gevonden in je Portflow
            </span>
          )}
        </section>
      )}
    </div>
  );
}
