"use client";

import Link from "next/link";
import { FolderOpen, MessageSquareText, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MirrorCollection, MirrorRow } from "@/lib/school/mirror";
import { evidencePrompt } from "@/lib/school/prompt";
import { Chip, EvidenceLine, Loading, PromptButton, UploadButton, typeOf, useMirror } from "./portflow-ui";

function FeedbackNote({ row, compact }: { row: MirrorRow; compact?: boolean }) {
  if (!row.feedback) return null;
  const ok = row.feedback.found.length > 0;
  if (compact) {
    const tip = ok ? `Feedback staat erbij: ${row.feedback.found.map((f) => f.name).join(", ")}` : `Feedback nodig: ${row.feedback.who}`;
    return (
      <span title={tip} className={cn("inline-flex items-center gap-1 text-[11px]", ok ? "text-pink-500" : "text-pink-600 font-medium")}>
        <MessageSquareText className="size-3" /> {ok ? "feedback ✓" : "feedback nodig"}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-start gap-1 text-xs", ok ? "text-pink-700" : "text-pink-600")}>
      <MessageSquareText className="size-3.5 mt-px shrink-0" />
      {ok ? `Feedback staat erbij (${row.feedback.found.map((f) => f.name).join(", ")})` : compact ? "Feedback nodig" : `Feedback nodig: ${row.feedback.who}`}
    </span>
  );
}

export function Row({ row, c, goal, compact }: { row: MirrorRow; c: MirrorCollection; goal: string; compact?: boolean }) {
  const t = typeOf(row.type);
  const Icon = t.icon;
  const todo = row.state === "todo";
  const href = row.state === "extra" ? undefined : `/collectie/${c.slug}/${encodeURIComponent(row.key)}`;
  return (
    <li className={cn(compact ? "px-2.5 py-1.5" : "px-4 py-3", todo ? "bg-zinc-100/80" : "bg-white")}>
      <div className={cn("flex items-start", compact ? "gap-2" : "gap-3")}>
        <span className={cn("grid shrink-0 place-items-center rounded-full", compact ? "size-6" : "size-9", todo ? "bg-zinc-200 text-zinc-400" : t.circle)}>
          <Icon className={compact ? "size-3" : "size-4"} />
        </span>
        <div className={cn("flex-1 min-w-0 flex", compact ? "flex-wrap items-center gap-x-2 gap-y-0.5" : "flex-col gap-1.5")}>
          {todo ? (
            <>
              <Link href={href!} target="_blank" className={cn("font-medium text-zinc-500 leading-snug hover:underline", compact && "text-sm")}>
                {row.title}
                {row.optional && <span className="ml-1.5 text-xs font-normal">(optioneel)</span>}
              </Link>
              {!compact && <span className="text-xs text-zinc-500">{row.what}</span>}
              <span className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span className="rounded-md border border-dashed border-zinc-400 px-1.5 py-0.5">{compact ? t.label : `Nog toevoegen · ${t.label}`}</span>
                {row.sub && <Chip>{row.sub}</Chip>}
              </span>
            </>
          ) : (
            <>
              {row.state === "have" && !compact && <span className="text-[11px] uppercase tracking-wide text-zinc-400">{row.title}</span>}
              {row.evidence.map((e) => (
                <EvidenceLine key={e.id} e={e} href={href} small={compact} />
              ))}
            </>
          )}
          <FeedbackNote row={row} compact={compact} />
        </div>
        {row.state !== "extra" && <PromptButton iconOnly={compact} prompt={() => evidencePrompt(row, c.name, goal)} />}
      </div>
    </li>
  );
}

/** One collection as Portflow shows it, with what should be there in grey. */
export function PortflowCollection({ slug }: { slug: string }) {
  const { data, error, load } = useMirror();
  if (!data) return <Loading error={error} />;
  const c = data.collections.find((x) => x.slug === slug);
  if (!c) return <p className="p-6 text-sm">Deze collectie bestaat niet. <Link href="/" className="text-blue-600">Terug</Link></p>;

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-600">
        <Link href="/" className="hover:text-zinc-900">Collecties</Link> /
        <span>ICT Propedeuse - 2026 - 2027 - semester 1 - ICT In Action</span> /
        <span className="text-zinc-900">{c.name.replace(/^De /, "de ")}</span>
      </nav>

      <div className="rounded-xl bg-white ring-1 ring-zinc-200 p-5 flex flex-wrap items-center gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-lg text-white" style={{ background: c.color }}>
          <FolderOpen className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{c.name.replace(/^De /, "de ")}</h1>
          <p className="text-sm italic text-zinc-600">{c.description}</p>
        </div>
        <span className="text-sm tabular-nums text-zinc-500 whitespace-nowrap">{c.have}/{c.total} aanwezig</span>
        <UploadButton onDone={load} />
      </div>

      {c.unlinked.length > 0 && (
        <ul className="rounded-xl ring-1 ring-zinc-200 overflow-hidden divide-y divide-zinc-200">
          {c.unlinked.map((r) => (
            <Row key={r.key} c={c} goal="geen leerdoel" row={{ ...r, evidence: r.evidence.map((e) => ({ ...e, fix: "geen doel gekoppeld: koppel het aan een leerdoel" })) }} />
          ))}
        </ul>
      )}

      {c.sections.map((s) => (
        <section key={s.goal} className="rounded-xl ring-1 ring-zinc-200 overflow-hidden">
          <header className="flex flex-wrap items-center gap-3 bg-[#3f4752] px-4 py-3 text-white">
            <Target className="size-5" />
            <h2 className="font-semibold">{s.name}</h2>
            <span className="ml-auto text-xs text-white/70">
              {s.rows.filter((r) => r.state !== "todo").length} bewijzen · {s.rows.filter((r) => r.state === "todo" && !r.optional).length} nog toevoegen
            </span>
          </header>
          {s.rows.length === 0 ? (
            <p className="bg-white px-4 py-6 text-center text-sm text-zinc-500">Niets te zien hier, geen bewijs.</p>
          ) : (
            <ul className="divide-y divide-zinc-200">
              {s.rows.map((r) => (
                <Row key={r.key} c={c} goal={s.name} row={r} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
