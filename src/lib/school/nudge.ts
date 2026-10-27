import { addDays, dayKey, weekStart } from "@/lib/dates";
import { PORTFLOW, SCHOOL } from "@/lib/config";
import { keyExists, sendPrompt } from "@/lib/coach/prompts";
import type { InlineButton } from "@/lib/telegram/api";
import { listTracked, type RoadmapItem } from "./roadmap";
import { itemDetail, schoolPicture } from "./priorities";
import { lastImport } from "./portflow";
import { currentSprints } from "./sprints";

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

/**
 * "Stuur even een Portflow-screenshot": in the last days of a sprint when none
 * came in during its last week, or when the last one is PORTFLOW.staleDays
 * old. Once per sprint / per week. The buttons open the screenshot wait or
 * draft the Sprint Review.
 */
export async function screenshotReminder() {
  const today = dayKey();
  const { current } = await currentSprints(today);
  const last = await lastImport();
  const daysLeft = current ? Math.round((Date.parse(current.end) - Date.parse(today)) / 86_400_000) : null;

  let key: string | null = null;
  let text = "";
  if (current && current.number > 0 && daysLeft !== null && daysLeft >= 0 && daysLeft <= PORTFLOW.remindDaysBeforeEnd) {
    const weekBefore = addDays(current.end, -7);
    if (last && dayKey(last) >= weekBefore) return false;
    key = `portflow:sprint:${current.number}`;
    text = `📸 ${current.name} loopt ${daysLeft === 0 ? "vandaag" : daysLeft === 1 ? "morgen" : `over ${daysLeft} dagen`} af. Stuur even een screenshot van Mijn bewijs, dan check ik wat er voor deze sprint nog mist. Zal ik ook je Sprint Review voorbereiden?`;
  } else if (!last || Date.now() - last.getTime() > PORTFLOW.staleDays * 86_400_000) {
    // Never sent anything: only once the sprints are known (so it's semester time).
    if (!current) return false;
    key = `portflow:stale:${weekStart(today)}`;
    text = last
      ? `📸 Je laatste Portflow-screenshot is van ${Math.round((Date.now() - last.getTime()) / 86_400_000)} dagen geleden. Stuur er even een, dan kijk ik wat er mist voor ${current.name}.`
      : "📸 Stuur eens een screenshot van Mijn bewijs in Portflow, dan houd ik per sprint bij wat er nog mist (retro, sprint review, bewijs per leeruitkomst).";
  }
  if (!key || (await keyExists(key))) return false;
  const sent = await sendPrompt({
    kind: "portflow",
    dedupKey: key,
    text,
    buttons: (id) => [
      [
        { text: "📸 Nu sturen", data: `c:${id}:shots` },
        { text: "📝 Sprint Review", data: `c:${id}:review` },
      ],
      [{ text: "Later", data: `c:${id}:later` }],
    ],
  });
  return Boolean(sent);
}
