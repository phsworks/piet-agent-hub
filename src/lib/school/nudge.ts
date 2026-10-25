import { dayKey, weekStart } from "@/lib/dates";
import { SCHOOL } from "@/lib/config";
import { keyExists, sendPrompt } from "@/lib/coach/prompts";
import type { InlineButton } from "@/lib/telegram/api";
import { listTracked, type RoadmapItem } from "./roadmap";
import { itemDetail, schoolPicture } from "./priorities";

// Buttons under a school message: "c:<prompt id>:<status>" (or "later").

export type SchoolPayload = { text: string; itemId: string };

export function statusButtons(id: string, item: Pick<RoadmapItem, "status">): InlineButton[][] {
  const options = [
    { status: "bezig", text: "🔨 Bezig" },
    { status: "klaar", text: "✅ Klaar" },
    { status: "in_portflow", text: "📎 In Portflow" },
  ].filter((o) => o.status !== item.status);
  return [options.map((o) => ({ text: o.text, data: `c:${id}:${o.status}` }))];
}

/** /school <item>: the details, with buttons to change the status. */
export async function sendItemCard(item: RoadmapItem) {
  const text = itemDetail(item, await schoolPicture());
  const payload: SchoolPayload = { text, itemId: item.id };
  // Every card is its own prompt (unique key), so buttons on an older card keep working.
  return sendPrompt({
    kind: "school_card",
    dedupKey: `school_card:${item.id}:${Date.now()}`,
    text,
    payload,
    buttons: (id) => statusButtons(id, item),
  });
}

/**
 * Something Piet marked klaar a while ago but not as in Portflow: the step the
 * roadmap keeps asking for ("voeg de link toe als bewijs in Portflow") and the
 * one that's easiest to forget. Once per item per week.
 */
export async function portflowNudge() {
  const before = Date.now() - SCHOOL.portflowAfterDays * 86_400_000;
  const week = weekStart(dayKey());
  for (const item of await listTracked()) {
    if (item.status !== "klaar" || (item.statusAt && item.statusAt.getTime() > before)) continue;
    const key = `school:portflow:${item.id}:${week}`;
    if (await keyExists(key)) continue;
    const text = `📎 ${item.title} is klaar, maar staat nog niet in Portflow. Even de link als bewijs toevoegen?${item.evidenceUrl ? `\n${item.evidenceUrl}` : ""}`;
    const payload: SchoolPayload = { text, itemId: item.id };
    const sent = await sendPrompt({
      kind: "school",
      dedupKey: key,
      text,
      payload,
      buttons: (id) => [
        [
          { text: "📎 Staat erin", data: `c:${id}:in_portflow` },
          { text: "Later", data: `c:${id}:later` },
        ],
      ],
    });
    if (sent) return true;
  }
  return false;
}
