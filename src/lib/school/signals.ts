import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { gitlabItems, gitlabProjects } from "@/lib/db/schema";
import { SCHOOL } from "@/lib/config";
import { listTracked, updateSchoolItem, type RoadmapItem } from "./roadmap";

// Links Piet's own GitLab activity in school projects to roadmap items by
// words, in code. Deliberately cautious: a match only ever moves an item from
// todo to bezig, and words can be tuned per item (update_school_item match).

// Title words too generic to mean "this item" on their own.
const STOP = new Set([
  "maken", "schrijven", "ontwerpen", "ontwikkelen", "documentatie", "documenteren", "analyse",
  "onderzoek", "rapport", "basis", "voor", "met", "van", "werk", "houden", "overzicht", "profiel",
]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The item's own match words, or significant words from its title (and the whole title). */
export function matchWords(item: Pick<RoadmapItem, "title" | "match">) {
  if (item.match.length) return item.match;
  const title = item.title.toLowerCase();
  const words = title.split(/[^a-z0-9à-ü]+/).filter((w) => w.length >= 5 && !STOP.has(w));
  return [...new Set([title, ...words])];
}

function matcher(words: string[]) {
  // Word boundaries that also work around "/" and "&" in titles like "CI/CD".
  const re = new RegExp(`(^|[^a-z0-9])(${words.map(escape).join("|")})($|[^a-z0-9])`, "i");
  return (text: string) => re.test(text);
}

export type Signal = { count: number; lastAt: Date; examples: string[] };

/** Piet's own commits, MRs and issues in school projects of the last SCHOOL.signalDays, per item. */
export async function gitlabSignals(items?: RoadmapItem[]) {
  const since = new Date(Date.now() - SCHOOL.signalDays * 86_400_000);
  const [tracked, activity] = await Promise.all([
    items ?? listTracked(),
    db
      .select({ title: gitlabItems.title, type: gitlabItems.type, labels: gitlabItems.labels, at: gitlabItems.happenedAt, project: gitlabProjects.name })
      .from(gitlabItems)
      .innerJoin(gitlabProjects, eq(gitlabProjects.id, gitlabItems.projectId))
      .where(and(eq(gitlabProjects.kind, "school"), eq(gitlabItems.mine, true), gte(gitlabItems.happenedAt, since))),
  ]);
  const signals = new Map<string, Signal>();
  for (const item of tracked) {
    const hit = matcher(matchWords(item));
    const found = activity.filter((a) => hit(`${a.title} ${a.labels.join(" ")}`));
    if (found.length === 0) continue;
    found.sort((a, b) => b.at.getTime() - a.at.getTime());
    signals.set(item.id, {
      count: found.length,
      lastAt: found[0].at,
      examples: found.slice(0, 3).map((a) => `${a.project}: ${a.title}`),
    });
  }
  return signals;
}

/** After a GitLab sync: items Piet is visibly working on go from todo to bezig. */
export async function applyGitLabSignals() {
  const tracked = await listTracked();
  const signals = await gitlabSignals(tracked);
  const started = tracked.filter((i) => i.status === "todo" && signals.has(i.id));
  for (const item of started) await updateSchoolItem(item.id, { status: "bezig" }, "gitlab");
  if (started.length) console.log(`[school] bezig via GitLab: ${started.map((i) => i.title).join(", ")}`);
}
