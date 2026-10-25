import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents } from "@/lib/db/schema";
import { listEvents } from "@/lib/calendar/feeds";
import { addDays, dayKey, timeKey, zonedDate } from "@/lib/dates";
import { COACH } from "@/lib/config";
import type { InlineButton } from "@/lib/telegram/api";
import { freeBlocks, slotHours, type Slot } from "./slots";
import { claimKey, sendPrompt } from "./prompts";

// More free blocks than this only makes the message long.
const MAX_BLOCKS = 3;
const TITLE_PREFIX = "Focus: ";

/** "Werk aan …?" message: Piet picks a project, then (with several blocks) a time. */
export type FocusPayload = {
  text: string;
  blocks: Slot[];
  options: { id: string; name: string }[];
  /** Index into options once Piet picked a project. */
  picked?: number;
};

/** Projects from the folder tree (School › Semester › Kova, Projects › Huismaatje, ...). */
export async function focusOptions() {
  const rows = await db.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.kind, "project"));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** A planned block: at most COACH.focus.maxMinutes from the start of the free stretch. */
export function focusSlot(block: Slot): Slot {
  const end = Math.min(Date.parse(block.end), Date.parse(block.start) + COACH.focus.maxMinutes * 60_000);
  return { start: block.start, end: new Date(end).toISOString() };
}

export const focusTitle = (name: string) => `${TITLE_PREFIX}${name}`;

const blockLine = (b: Slot) => `${timeKey(new Date(b.start))}–${timeKey(new Date(b.end))} (${slotHours(b)})`;

/**
 * Once a day, after the morning check-in (no AI): the big free stretches of
 * today and Piet's projects as buttons. Skipped when there's no stretch of at
 * least COACH.focus.minMinutes or a focus block is already planned.
 */
export async function focusSuggestion() {
  const today = dayKey();
  const key = `focus:${today}`;
  const [options, events] = await Promise.all([
    focusOptions(),
    listEvents(zonedDate(today), zonedDate(addDays(today, 1))),
  ]);
  const blocks = (await freeBlocks({ day: today, ...COACH.focus })).slice(0, MAX_BLOCKS);
  if (options.length === 0 || blocks.length === 0 || events.some((e) => e.title.startsWith(TITLE_PREFIX))) {
    await claimKey("focus", key);
    return;
  }
  // Chronological in the text, the longest one first in the buttons.
  const lines = [...blocks].sort((a, b) => a.start.localeCompare(b.start)).map(blockLine);
  const text =
    blocks.length === 1
      ? `💡 Je hebt vandaag ${lines[0]} vrij. Waar wil je aan werken?`
      : `💡 Je hebt vandaag nog tijd vrij:\n${lines.map((l) => `- ${l}`).join("\n")}\nWaar wil je aan werken?`;
  const payload: FocusPayload = { text, blocks, options };
  await sendPrompt({ kind: "focus", dedupKey: key, text, payload, buttons: (id) => focusButtons(id, payload) });
}

export function focusButtons(id: string, payload: FocusPayload): InlineButton[][] {
  const short = (s: string) => (s.length > 24 ? `${s.slice(0, 23)}…` : s);
  const skip = [{ text: "Niet vandaag", data: `c:${id}:skip` }];
  if (payload.picked === undefined) {
    // Two projects per row.
    const rows: InlineButton[][] = [];
    payload.options.forEach((o, i) => {
      const button = { text: short(o.name), data: `c:${id}:p${i}` };
      if (i % 2 === 0) rows.push([button]);
      else rows[rows.length - 1].push(button);
    });
    return [...rows, skip];
  }
  return [payload.blocks.map((b, i) => ({ text: blockLine(focusSlot(b)).replace(/ \(.*\)/, ""), data: `c:${id}:b${i}` })), skip];
}
