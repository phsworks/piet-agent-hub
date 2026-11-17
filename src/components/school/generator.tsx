"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Marked } from "marked";
import { toast } from "sonner";
import { Copy, Download, FolderSync, Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { Generated, GenerateKind } from "@/lib/school/generate";
import { relative } from "./portflow-ui";
import { syncProject, syncRemembered } from "./project-sync";

// Raw HTML from the model is dropped; only Markdown is rendered.
const md = new Marked({ renderer: { html: () => "" } });

const KIND_LABEL: Record<GenerateKind, string> = {
  docs: "docs-pagina (.md)",
  document: "document (.docx of .md)",
  link: "link + feedbacktekst",
};

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Edit the prompt, let the hub write it with the Kova repo as context, tweak, download. */
export function Generator({ genKey, kind, title, hint, initialPrompt }: { genKey: string; kind: GenerateKind; title: string; hint: string; initialPrompt: string }) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [result, setResult] = useState<Generated | null>(null);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<"gen" | "docx" | "sync" | null>(null);
  const [raw, setRaw] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [local, setLocal] = useState<{ at: string; branch: string; files: number } | null>(null);

  const loadLocal = () =>
    fetch("/api/school/local-project")
      .then((r) => (r.ok ? r.json() : null))
      .then(setLocal)
      .catch(() => {});
  useEffect(() => {
    loadLocal();
  }, []);

  async function sync() {
    setBusy("sync");
    try {
      toast.success(`Project bijgewerkt: ${await syncProject()} bestanden`);
      await loadLocal();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) toast.error(err instanceof Error ? err.message : "Project bijwerken mislukt");
    } finally {
      setBusy(null);
    }
  }

  // Restore the prompt as Piet left it (with his feedback) and the last result.
  useEffect(() => {
    let ignore = false;
    fetch(`/api/school/generate?key=${encodeURIComponent(genKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((g: Generated | null) => {
        if (ignore || !g) return;
        if (g.prompt) setPrompt(g.prompt);
        if (g.markdown) setResult(g);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [genKey]);

  // Save while typing (1 s after the last key), so nothing is lost on reload or another device.
  function edit(value: string) {
    setPrompt(value);
    setSaved("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fetch("/api/school/generate", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: genKey, prompt: value }) })
        .then((r) => setSaved(r.ok ? "saved" : "idle"))
        .catch(() => setSaved("idle"));
    }, 1000);
  }

  function reset() {
    edit(initialPrompt);
  }

  const html = useMemo(() => (result ? (md.parse(result.markdown, { async: false }) as string) : ""), [result]);

  async function run(revise: boolean) {
    setBusy("gen");
    try {
      // Newest code first when the browser still has the folder (no prompt); otherwise the last sync.
      if (await syncRemembered().catch(() => null)) await loadLocal();
      const res = await fetch("/api/school/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: genKey, kind, prompt, hint, ...(revise && result ? { previous: result.markdown, instruction } : {}) }),
      });
      if (!res.ok) throw new Error(await res.text());
      setResult(await res.json());
      if (revise) setInstruction("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Genereren mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function docx() {
    if (!result) return;
    setBusy("docx");
    try {
      const res = await fetch("/api/school/generate/docx", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, markdown: result.markdown }) });
      if (!res.ok) throw new Error(await res.text());
      download(`${title}.docx`, await res.blob());
      toast.success("Word-bestand gedownload (ook in Drive › PietBrain › Gemaakt › School)");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Word-bestand maken mislukt");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl bg-violet-50/60 ring-1 ring-violet-200 p-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold mr-auto inline-flex items-center gap-2">
          <Sparkles className="size-4 text-violet-600" /> Laten maken · {KIND_LABEL[kind]}
        </h2>
        <button type="button" onClick={() => navigator.clipboard.writeText(prompt).then(() => toast.success("Prompt gekopieerd"))} className="inline-flex items-center gap-1 text-xs text-violet-700 hover:underline">
          <Copy className="size-3.5" /> Kopieer prompt
        </button>
      </div>
      <Textarea value={prompt} onChange={(e) => edit(e.target.value)} rows={8} className="bg-white text-sm" />
      <div className="flex items-center gap-3 -mt-1 text-[11px] text-zinc-500">
        <span>{saved === "saving" ? "Opslaan…" : saved === "saved" ? "Prompt opgeslagen" : "Je aanpassingen worden bewaard"}</span>
        {prompt !== initialPrompt && (
          <button type="button" onClick={reset} className="hover:underline">
            Terug naar standaardprompt
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => run(false)} disabled={busy !== null || !prompt.trim()}>
          {busy === "gen" ? <Loader2 className="animate-spin" /> : <Wand2 />}
          {busy === "gen" ? "Zoekt en schrijft (± 1-2 min)…" : result ? "Opnieuw genereren" : "Genereer"}
        </Button>
        <Button variant="outline" onClick={sync} disabled={busy !== null}>
          {busy === "sync" ? <Loader2 className="animate-spin" /> : <FolderSync />} Project bijwerken
        </Button>
        <span className="text-xs text-zinc-500">Zoekt zelf in {local ? `je project (${local.files} bestanden, gesynct ${relative(local.at)})` : "GitLab"}, je notities, GitLab-werk en Portflow.</span>
      </div>

      {result && (
        <div className="flex flex-col gap-3 border-t border-violet-200 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500 mr-auto">Gemaakt {relative(result.at)}</span>
            <button type="button" onClick={() => setRaw((r) => !r)} className="text-xs text-zinc-600 hover:underline">
              {raw ? "Opgemaakt" : "Markdown"}
            </button>
            {kind === "link" && (
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(result.markdown).then(() => toast.success("Tekst gekopieerd"))}>
                <Copy /> Kopieer tekst
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => download(`${title}.md`, new Blob([result.markdown], { type: "text/markdown" }))}>
              <Download /> .md
            </Button>
            {kind === "document" && (
              <Button size="sm" variant="outline" onClick={docx} disabled={busy !== null}>
                {busy === "docx" ? <Loader2 className="animate-spin" /> : <Download />} .docx
              </Button>
            )}
          </div>
          {raw ? (
            <pre className="whitespace-pre-wrap rounded-lg bg-white p-4 text-xs ring-1 ring-zinc-200">{result.markdown}</pre>
          ) : (
            <div className="md-preview rounded-lg bg-white p-5 ring-1 ring-zinc-200" dangerouslySetInnerHTML={{ __html: html }} />
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (instruction.trim()) run(true);
            }}
          >
            <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Bijstellen: bijv. korter, voeg een klassendiagram toe, meer over security…" className="bg-white" />
            <Button type="submit" variant="outline" disabled={busy !== null || !instruction.trim()}>
              <RefreshCw /> Bijstellen
            </Button>
          </form>
        </div>
      )}
    </section>
  );
}
