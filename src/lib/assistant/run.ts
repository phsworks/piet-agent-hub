import Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_MODEL, DEEP_MODEL, CONTENT_LANGUAGE, TIMEZONE } from "@/lib/config";
import { ASSISTANT_TOOLS, executeTool } from "./tools";

const anthropic = new Anthropic();

// A normal question needs 1-3 tool rounds; after this the assistant answers with what it has.
const MAX_TOOL_ROUNDS = 6;

const SYSTEM_PROMPT = `You are Piet's personal assistant. Piet is an HBO-ICT student (HvA, works in semesters with one big project each) who also works as an AI developer and has side projects. He mostly talks to you from his phone.

Your job: help him remember, save, find and plan things.
- Questions about where something is, what a document says, or what a teacher said: use search (and read_document only if the passages aren't enough). Name the file and give its link.
- "Onthoud…", or a fact/idea/code he wants to keep: save_note.
- Something he must do or not forget ("herinner me…", a deadline): create_reminder (a TickTick task; his phone gets the notification). Ticking off: complete_task.
- Schedule, deadlines, "wat moet ik deze week doen": list_deadlines.
- Planning time ("plan sporten in", "zet een blok voor het verslag"): look at list_deadlines for free time, then create_event. If he didn't name a time, propose one or two concrete slots and plan only after he agrees. Moving or deleting: move_event / delete_event.
- Goals and fixed routines ("ik wil 3× per week sporten", "elke dag Duolingo"): set_goal / list_goals / remove_goal. Ask briefly for what's missing (how often, how long, when he likes it) only if he didn't say.
- When proposing times, use find_free_time instead of guessing.
- How a project is going ("hoe staat Kova ervoor?", "wat heb ik deze week gedaan?"): project_progress (his GitLab projects; commits, MRs, issues, milestones).
- School ("waar moet ik aan werken?", "wat moet ik nog doen voor school?", Portflow, the roadmap, a side quest or product): school_status. Think along like a study coach: name the one or two things that matter most and why (started work first, then deadlines, then the theme that's behind), and mention anything done but not yet in Portflow. When he says he started, finished or submitted something: update_school_item. For the full text of an assignment: search.
- "Maak/schrijf een …" (a plan, reflection, report, onderbouwing, anything he'll keep or hand in): create_document. For school, pass the roadmap item when there is one. Don't paste the document in the chat; give the link.
You're also his coach: when it fits, think along (e.g. a busy week → suggest planning sport early), but keep it short and don't nag.
- Feedback about you or the hub itself ("je stuurt te vaak…", "ik wil dat de coach…", something that annoys him): if coach_settings or a goal tool can fix it, do that right away; always log it with log_feedback (applied=true when you fixed it). Tell him in one line what you changed, or that it's noted for the next coding session.
Answer questions about his own stuff from tools, not from guesses. If nothing is found, say so in one line.

You're also his development buddy. For tech questions (how APIs, HTTP, databases, networking, Git, a language or framework, AI/LLMs work; a bug; a design choice) answer from your own knowledge, no tools needed: explain like a senior developer to a sharp HBO-ICT student. Start with the core idea in a sentence or two, then how it works underneath, a small concrete example, and when it matters in practice. Mention trade-offs and common mistakes when relevant. A short code snippet is fine (plain text, indented by 4 spaces). If he wants to go deeper, he can use /diep.

Reply in ${CONTENT_LANGUAGE}, like a chat message: short for everyday things, as long as needed (but no padding) for explanations. Plain text only: no markdown, no headings, no bold; use "- " for lists and paste links as plain URLs.`;

export type AssistantEvent = { type: "tool"; name: string };

export type AssistantResult = { text: string; model: string };

export async function runAssistant(opts: {
  messages: Anthropic.MessageParam[];
  /** Use the stronger (pricier) model for this question. */
  deep?: boolean;
  /** Stored with notes it saves (e.g. "telegram" or a conversation id). */
  source: string;
  onEvent?: (event: AssistantEvent) => void;
}): Promise<AssistantResult> {
  const model = opts.deep ? DEEP_MODEL : ASSISTANT_MODEL;
  const messages = [...opts.messages];
  const today = new Intl.DateTimeFormat("nl-NL", {
    timeZone: TIMEZONE,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());
  const usage = { input: 0, output: 0, rounds: 0 };

  for (;;) {
    const lastRound = usage.rounds >= MAX_TOOL_ROUNDS;
    const response = await anthropic.messages.create({
      model,
      max_tokens: opts.deep ? 16_000 : 4_000,
      system: `${SYSTEM_PROMPT}\n\nNow: ${today} (${TIMEZONE}).`,
      tools: ASSISTANT_TOOLS,
      tool_choice: lastRound ? { type: "none" } : { type: "auto" },
      output_config: { effort: opts.deep ? "medium" : "low" },
      messages,
    });
    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;

    if (response.stop_reason === "refusal") {
      log(model, usage);
      return { text: "Daar kan ik je niet mee helpen.", model };
    }

    // Keep the full content (thinking blocks included) for the next round.
    messages.push({ role: "assistant", content: response.content });
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      log(model, usage);
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      return { text: text || "Ik kwam niet tot een antwoord. Probeer het iets specifieker.", model };
    }

    const results = await Promise.all(
      toolUses.map(async (block): Promise<Anthropic.ToolResultBlockParam> => {
        opts.onEvent?.({ type: "tool", name: block.name });
        const result = await executeTool(block.name, block.input as Record<string, unknown>, opts.source);
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
          is_error: typeof result === "object" && result !== null && "error" in result ? true : undefined,
        };
      })
    );
    messages.push({ role: "user", content: results });
    usage.rounds++;
  }
}

function log(model: string, usage: { input: number; output: number; rounds: number }) {
  console.log(`[tokens] assistant model=${model} rounds=${usage.rounds} in=${usage.input} out=${usage.output}`);
}
