import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { gitlabItems } from "@/lib/db/schema";
import { addDays, dayKey } from "@/lib/dates";
import { PORTFLOW } from "@/lib/config";

// Sprints come from GitLab: the Kova project has milestones "Sprint 1" … with
// start and due dates. Several projects may share them; one per number is kept.

export type Sprint = {
  /** 0 = onboarding. */
  number: number;
  name: string;
  start: string;
  end: string;
  /** Up to (not including) the next sprint's start: evidence from the weekend or a holiday still counts. */
  until: string;
};

export async function listSprints(): Promise<Sprint[]> {
  const rows = await db
    .select({ title: gitlabItems.title, startOn: gitlabItems.startOn, dueOn: gitlabItems.dueOn })
    .from(gitlabItems)
    .where(eq(gitlabItems.type, "milestone"));

  const byNumber = new Map<number, { startOn: string | null; dueOn: string }>();
  for (const r of rows) {
    const match = PORTFLOW.sprintPattern.exec(r.title.trim());
    if (!match || !r.dueOn) continue;
    const n = Number(match[1]);
    const known = byNumber.get(n);
    if (!known || (!known.startOn && r.startOn)) byNumber.set(n, { startOn: r.startOn, dueOn: r.dueOn });
  }

  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  const sprints: Sprint[] = [];
  for (const [i, n] of numbers.entries()) {
    const { startOn, dueOn } = byNumber.get(n)!;
    // No start date in GitLab (or not synced yet): the day after the previous one ended.
    const start = startOn ?? (i > 0 ? addDays(sprints[i - 1].end, 1) : addDays(dueOn, -25));
    sprints.push({ number: n, name: `Sprint ${n}`, start, end: dueOn, until: "" });
  }
  if (sprints.length) {
    const first = sprints[0].start;
    sprints.unshift({ number: 0, name: "Onboarding", start: addDays(first, -PORTFLOW.onboardingDays), end: addDays(first, -1), until: "" });
  }
  for (const [i, s] of sprints.entries()) s.until = sprints[i + 1]?.start ?? addDays(s.end, 14);
  return sprints;
}

/** The sprint a day falls in (between its start and the next sprint's start). */
export function sprintOn(sprints: Sprint[], day: string) {
  return sprints.find((s) => day >= s.start && day < s.until) ?? null;
}

/**
 * The sprint that's running and the one before it. Right after a sprint ends
 * its evidence (retrospective, review) usually still has to be added, so both
 * are checked.
 */
export async function currentSprints(today = dayKey()) {
  const sprints = await listSprints();
  const current = sprintOn(sprints, today);
  const previous = current ? (sprints.find((s) => s.number === current.number - 1) ?? null) : null;
  return { sprints, current, previous };
}

/** "Sprint 2" in an evidence name pins it to that sprint, whatever the date. */
export function sprintInName(name: string) {
  const match = /sprint\s*(\d+)/i.exec(name);
  if (match) return Number(match[1]);
  return /onboarding/i.test(name) ? 0 : null;
}
