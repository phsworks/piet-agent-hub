import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { coachPrompts } from "@/lib/db/schema";
import { addDays, dayKey } from "@/lib/dates";
import { completeTask, rescheduleTask } from "@/lib/ticktick/client";
import { findSlots, formatSlot, shortSlot } from "@/lib/coach/slots";
import { isDayPart } from "@/lib/coach/goals";
import { eveningButtons } from "@/lib/coach/checkins";
import { focusButtons, focusSlot, focusTitle, type FocusPayload } from "@/lib/coach/focus";
import { COACH_CALENDAR } from "@/lib/config";
import { isStatus, updateSchoolItem } from "@/lib/school/roadmap";
import { STATUS_LABEL } from "@/lib/school/priorities";
import { statusButtons, type SchoolPayload } from "@/lib/school/nudge";
import {
  logRoutine,
  planItem,
  type CoachPrompt,
  type EveningPayload,
  type SuggestionPayload,
  type WeeklyPayload,
} from "@/lib/coach/prompts";
import { answerCallback, editButtons, ownerChatId, type InlineButton, type TelegramCallbackQuery } from "./api";

// How many other times "Andere tijd" offers.
const ALTERNATIVES = 3;

/** A button press under a coach message: "c:<prompt id>:<action>". */
export async function handleCallback(query: TelegramCallbackQuery) {
  const chatId = query.message?.chat.id;
  if (!chatId || chatId !== ownerChatId() || !query.message) return answerCallback(query.id);
  const [, id, action] = (query.data ?? "").split(":");
  const [prompt] = id ? await db.select().from(coachPrompts).where(eq(coachPrompts.id, id)) : [];
  if (!prompt) return answerCallback(query.id, "Dit voorstel bestaat niet meer.");

  const messageId = query.message.message_id;
  const edit = (text: string, rows: InlineButton[][] = []) => editButtons(chatId, messageId, text, rows);
  try {
    if (prompt.kind === "evening") await evening(prompt, action, edit);
    else if (prompt.kind === "routine") await routine(prompt, action, edit);
    else if (prompt.kind === "weekly") await weekly(prompt, action, edit);
    else if (prompt.kind === "focus") await focus(prompt, action, edit);
    else if (prompt.kind === "school" || prompt.kind === "school_card") await school(prompt, action, edit);
    else await suggestion(prompt, action, edit);
    await answerCallback(query.id);
  } catch (err) {
    console.error("[coach] button failed", err);
    await answerCallback(query.id, err instanceof Error ? err.message.slice(0, 180) : "Er ging iets mis");
  }
}

type Edit = (text: string, rows?: InlineButton[][]) => Promise<void>;

async function setPrompt(prompt: CoachPrompt, values: { status?: string; payload?: object }) {
  await db.update(coachPrompts).set(values).where(eq(coachPrompts.id, prompt.id));
}

async function suggestion(prompt: CoachPrompt, action: string, edit: Edit) {
  const payload = prompt.payload as SuggestionPayload;
  if (!payload.item) return;

  if (action === "skip") {
    await setPrompt(prompt, { status: "skipped" });
    return edit(`${payload.text}\n\n— Overgeslagen`);
  }

  if (action === "alt") {
    const { item, search } = payload;
    const today = dayKey();
    const days = Math.max(Math.round((Date.parse(search.untilDay) - Date.parse(today)) / 86_400_000) + 1, 1);
    // Search a bit beyond this week so there's always something to offer.
    const alternatives = await findSlots({
      fromDay: today,
      days: Math.max(days, 4),
      durationMinutes: item.durationMinutes,
      preferred: isDayPart(search.preferred) ? search.preferred : "any",
      excludeDays: search.excludeDays,
      excludeStarts: [item.slot.start],
      limit: ALTERNATIVES,
    });
    if (alternatives.length === 0) {
      return edit(`${payload.text}\n\nGeen andere vrije momenten gevonden. Typ gewoon wanneer je wilt, dan plan ik het.`, [
        [{ text: "Overslaan", data: `c:${prompt.id}:skip` }],
      ]);
    }
    await setPrompt(prompt, { payload: { ...payload, alternatives } });
    return edit(`${payload.text}\n\nAndere momenten:`, [
      alternatives.map((slot, i) => ({ text: shortSlot(slot), data: `c:${prompt.id}:a${i}` })),
      [{ text: "Overslaan", data: `c:${prompt.id}:skip` }],
    ]);
  }

  const slot = action === "ok" ? payload.item.slot : payload.alternatives?.[Number(action.slice(1))];
  if (!slot || prompt.status === "planned") return;
  const result = await planItem({ ...payload.item, slot });
  await setPrompt(prompt, { status: "planned" });
  return edit(`${payload.text}\n\n✓ Ingepland: ${payload.item.title}, ${formatSlot(slot)} (${result.calendar})`);
}

/** Portflow reminder or a /school card: set the item's status. */
async function school(prompt: CoachPrompt, action: string, edit: Edit) {
  const payload = prompt.payload as SchoolPayload;
  if (action === "later") {
    await setPrompt(prompt, { status: "skipped" });
    return edit(`${payload.text}\n\n— Later`);
  }
  if (!isStatus(action)) return;
  const item = await updateSchoolItem(payload.itemId, { status: action });
  if (!item) return edit(`${payload.text}\n\nDit onderdeel staat niet meer in de roadmap.`);
  await setPrompt(prompt, { status: "done" });
  const note = `\n\n✓ ${item.title}: ${STATUS_LABEL[action]}`;
  // A card keeps its buttons so Piet can move on later (bezig → klaar → in Portflow).
  return edit(`${payload.text}${note}`, prompt.kind === "school_card" && action !== "in_portflow" ? statusButtons(prompt.id, item) : []);
}

async function routine(prompt: CoachPrompt, action: string, edit: Edit) {
  const { text, goalId } = prompt.payload as { text: string; goalId: string };
  if (prompt.status !== "sent" || (action !== "d" && action !== "n")) return;
  await logRoutine(goalId, prompt.day ?? dayKey(), action === "d" ? "done" : "skipped");
  await setPrompt(prompt, { status: action === "d" ? "done" : "skipped" });
  return edit(`${text}\n\n${action === "d" ? "✓ Gedaan. Slaap lekker 🌙" : "— Vandaag niet, prima."}`);
}

async function focus(prompt: CoachPrompt, action: string, edit: Edit) {
  const payload = prompt.payload as FocusPayload;
  if (prompt.status !== "sent") return;
  if (action === "skip") {
    await setPrompt(prompt, { status: "skipped" });
    return edit(`${payload.text}\n\n— Vandaag niet`);
  }

  if (action[0] === "p") {
    const picked = Number(action.slice(1));
    if (!payload.options[picked]) return;
    payload.picked = picked;
    await setPrompt(prompt, { payload });
    // One free stretch: no need to ask when.
    if (payload.blocks.length > 1) {
      return edit(`${payload.text}\n\n${payload.options[picked].name}. Wanneer?`, focusButtons(prompt.id, payload));
    }
    action = "b0";
  }

  const block = payload.blocks[Number(action.slice(1))];
  if (action[0] !== "b" || !block || payload.picked === undefined) return;
  const slot = focusSlot(block);
  const name = payload.options[payload.picked].name;
  // Mark first so a double tap doesn't plan it twice; undo when iCloud fails.
  await setPrompt(prompt, { status: "planned" });
  const durationMinutes = (Date.parse(slot.end) - Date.parse(slot.start)) / 60_000;
  await planItem({ title: focusTitle(name), calendar: COACH_CALENDAR, slot, durationMinutes }).catch(async (err) => {
    await setPrompt(prompt, { status: "sent" });
    throw err;
  });
  return edit(`${payload.text}\n\n✓ Ingepland: ${focusTitle(name)}, ${formatSlot(slot)}`);
}

async function weekly(prompt: CoachPrompt, action: string, edit: Edit) {
  const payload = prompt.payload as WeeklyPayload;
  if (action === "skip") {
    await setPrompt(prompt, { status: "skipped" });
    return edit(`${payload.text}\n\n— Niet ingepland`);
  }
  if (action !== "all" || prompt.status === "planned") return;
  // Mark first: a double tap shouldn't plan everything twice.
  await setPrompt(prompt, { status: "planned" });
  const failed: string[] = [];
  for (const item of payload.plan) {
    await planItem(item).catch((err) => {
      console.error("[coach] planning failed", err);
      failed.push(item.title);
    });
  }
  const note = failed.length ? `\n\n⚠️ Niet gelukt: ${failed.join(", ")}` : "";
  return edit(`${payload.text}\n\n✓ Alles staat in je agenda${note}`);
}

async function evening(prompt: CoachPrompt, action: string, edit: Edit) {
  const payload = prompt.payload as EveningPayload;
  const index = Number(action.slice(1));
  const item = payload.items[index];
  if (!item || item.state) return;
  const day = prompt.day ?? dayKey();

  switch (action[0]) {
    case "d":
      if (item.type === "goal") await logRoutine(item.id, day, "done");
      else await completeTask(item.id);
      item.state = "done";
      break;
    case "n":
      await logRoutine(item.id, day, "skipped");
      item.state = "not";
      break;
    case "m":
      await rescheduleTask(item.id, addDays(day, 1), item.dueTime ?? null);
      item.state = "moved";
      break;
    default:
      return;
  }
  await setPrompt(prompt, { payload });

  const lines = payload.items
    .filter((i) => i.state)
    .map((i) => `${i.state === "done" ? "✓" : i.state === "moved" ? "→ morgen:" : "✗"} ${i.title}`);
  const open = eveningButtons(prompt.id, payload.items);
  if (open.length === 0) await setPrompt(prompt, { status: "done" });
  const anyDone = payload.items.some((i) => i.state === "done");
  const closing = open.length === 0 ? (anyDone ? "\n\nLekker bezig. Slaap lekker 🌙" : "\n\nMorgen een nieuwe kans. Slaap lekker 🌙") : "";
  return edit(`${payload.text}\n\n${lines.join("\n")}${closing}`, open);
}
