import { getSetting, setSetting } from "@/lib/settings";
import { COACH } from "@/lib/config";

/**
 * Coach behavior Piet can change from Telegram ("minder seintjes", "geen
 * tech-feitjes meer"), so feedback like that is applied at once instead of
 * waiting for a code change. Stored as one setting; missing keys use defaults.
 */
export type CoachPrefs = {
  /** Suggestions per day (deadline + goal nudges), 0 = none. */
  maxNudgesPerDay: number;
  /** "X is due soon, plan an hour?" */
  deadlineNudges: boolean;
  /** "You have 13:00–17:00 free, what do you want to work on?" */
  focusSuggestion: boolean;
  /** A short tech fact in the morning check-in. */
  techFact: boolean;
  /** A project idea or learning point (earning money, growing as a developer) in the morning check-in. */
  growthTip: boolean;
  /** "No commits on Kova in 3 days and a milestone is coming, plan a block?" */
  projectNudges: boolean;
  /** "Retrospective is done but not in Portflow yet" and school focus in the check-ins. */
  schoolNudges: boolean;
  /** "Sprint 2 ends Friday, send a Portflow screenshot" and the Portflow line in the weekly review. */
  portflowReminders: boolean;
  /** ISO weekdays (1 = ma … 7 = zo) the coach never plans or suggests anything on, e.g. a work day with long travel. */
  noPlanDays: number[];
};

const KEY = "coach_prefs";

export const DEFAULT_PREFS: CoachPrefs = {
  maxNudgesPerDay: COACH.maxNudgesPerDay,
  deadlineNudges: true,
  focusSuggestion: true,
  techFact: true,
  growthTip: true,
  projectNudges: true,
  schoolNudges: true,
  portflowReminders: true,
  // Wednesday is Compagnon (work plus 1.5 h travel).
  noPlanDays: [3],
};

export async function getCoachPrefs(): Promise<CoachPrefs> {
  return { ...DEFAULT_PREFS, ...((await getSetting<Partial<CoachPrefs>>(KEY)) ?? {}) };
}

export async function setCoachPrefs(changes: Partial<CoachPrefs>) {
  const next = { ...(await getCoachPrefs()), ...changes };
  await setSetting(KEY, next);
  return next;
}
