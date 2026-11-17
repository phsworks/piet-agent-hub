import Anthropic from "@anthropic-ai/sdk";
import { CONTENT_LANGUAGE, DEEP_MODEL } from "@/lib/config";
import { getSetting, setSetting } from "@/lib/settings";
import { createGoogleDoc, ensureRootSubfolder, exportGoogleDoc } from "@/lib/google/drive";
import { dayKey } from "@/lib/dates";
import { AGENT_TOOLS, kovaProject, projectSource, runAgentTool } from "./agent";

// Generate a docs page or Portflow piece on its own: Sonnet looks through the
// Kova project, Piet's notes, his GitLab work and Portflow with tools (agent.ts)
// and then writes it. Piet only presses "Genereer" (and may tweak the prompt).

const anthropic = new Anthropic();
const SAVED_KEY = "school_generated";
// Enough to read a dozen files and check notes; the last round must write.
const MAX_ROUNDS = 10;

export type GenerateKind = "docs" | "document" | "link";
/** The prompt as Piet left it (also before any generation), and the last result if there is one. */
export type Generated = { prompt: string; markdown: string; at: string };

const SYSTEM: Record<GenerateKind, string> = {
  docs: `The result is a page for the Kova team's MkDocs (Material) documentation: one # title, ## per part, tables where useful, Mermaid diagrams (\`\`\`mermaid) for structure, flows and class diagrams.`,
  document: `The result is a document Piet uploads as evidence in his HvA Portflow portfolio (it becomes a .docx): a # title, short sections, concrete.`,
  link: `This evidence is a link, not a document. The result is short Markdown: "## Link" with the link(s) Piet put in his prompt, or else the best ones from my_gitlab_work (full URLs), one line each saying what it shows (none at all: [link toevoegen]); and, when the prompt is about feedback, "## Feedback" written out neatly as a Portflow comment (who gave it, what went well, what to improve, what Piet does with it), taken from the prompt or his notes.`,
};

const COMMON = `You work for Piet-Hein, a first-year HBO-ICT student at the HvA, on his team project Kova (Start-up Impact AI). Work on your own: Piet should not have to tell you anything you can look up. First look around with the tools: read the relevant code and docs (search_code, read_files), search his notes for the topic, feedback he got and how he likes things written (search_my_notes), and check my_gitlab_work / my_portflow where relevant. Then write. Facts only from the prompt and what the tools return; never invent features, names, results or feedback. Where something is truly unknown after searching, write [aanvullen: <what exactly>]. Write in ${CONTENT_LANGUAGE}, in Piet's tone (direct, concrete, no filler). Your final message is only the finished Markdown, nothing before or after it.`;

export async function generate(opts: { key: string; kind: GenerateKind; prompt: string; hint: string; previous?: string; instruction?: string }) {
  const project = await kovaProject();
  const source = await projectSource(project?.gitlabId ?? null);
  const sprint = /:(\d+)$/.exec(opts.key)?.[1];
  const revise = opts.previous && opts.instruction ? `\n\nVorige versie:\n${opts.previous}\n\nPas die versie aan: ${opts.instruction}` : "";
  const files = source ? `${source.label}. Files:\n${source.paths.join("\n").slice(0, 12_000)}` : "No project code available.";
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `${opts.prompt}${revise}${sprint ? `\n\n(Dit hoort bij sprint ${sprint}.)` : ""}\n\nOnderwerp: ${opts.hint}\n\n<project>\n${files}\n</project>` },
  ];
  const usage = { input: 0, output: 0, rounds: 0 };

  for (;;) {
    const last = usage.rounds >= MAX_ROUNDS;
    const response = await anthropic.messages.create({
      model: DEEP_MODEL,
      max_tokens: 16_000,
      output_config: { effort: "medium" },
      system: `${COMMON}\n\n${SYSTEM[opts.kind]}\n\nToday: ${dayKey()}.`,
      tools: AGENT_TOOLS,
      tool_choice: last ? { type: "none" } : { type: "auto" },
      messages,
    });
    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    if (response.stop_reason === "refusal") throw new Error("Het model weigerde dit te schrijven.");

    // Keep the full content (thinking blocks included) for the next round.
    messages.push({ role: "assistant", content: response.content });
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      console.log(`[tokens] school generate ${opts.kind} rounds=${usage.rounds} in=${usage.input} out=${usage.output}`);
      const markdown = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim()
        .replace(/^```(?:markdown)?\n([\s\S]*)\n```$/, "$1");
      if (!markdown) throw new Error("Het model gaf geen tekst terug.");
      const saved = (await getSetting<Record<string, Generated>>(SAVED_KEY)) ?? {};
      // The prompt stays exactly as typed (with his feedback); a revision instruction is not glued onto it.
      saved[opts.key] = { prompt: opts.prompt, markdown, at: new Date().toISOString() };
      await setSetting(SAVED_KEY, saved);
      return saved[opts.key];
    }

    const results = await Promise.all(
      toolUses.map(async (block): Promise<Anthropic.ToolResultBlockParam> => {
        const result = await runAgentTool(block.name, block.input as Record<string, unknown>, { source, projectId: project?.id ?? null }).catch((err) => ({ error: String(err) }));
        return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result).slice(0, 60_000), is_error: typeof result === "object" && result !== null && "error" in result ? true : undefined };
      }),
    );
    messages.push({ role: "user", content: results });
    usage.rounds++;
  }
}

/** Keeps the prompt while Piet types, so feedback he pasted in is never lost. */
export async function savePrompt(key: string, prompt: string) {
  const saved = (await getSetting<Record<string, Generated>>(SAVED_KEY)) ?? {};
  saved[key] = { markdown: saved[key]?.markdown ?? "", at: saved[key]?.at ?? "", prompt };
  await setSetting(SAVED_KEY, saved);
}

export async function savedGenerated(key: string) {
  return (await getSetting<Record<string, Generated>>(SAVED_KEY))?.[key] ?? null;
}

/** Saved as a Google Doc in /PietBrain/Gemaakt/School and returned as .docx. */
export async function toDocx(title: string, markdown: string) {
  const folderId = await ensureRootSubfolder("Gemaakt/School");
  const file = await createGoogleDoc({ name: `${dayKey()} ${title}`, text: markdown, folderId, markdown: true });
  return exportGoogleDoc(file.id, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}
