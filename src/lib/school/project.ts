import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { gitlabItems, gitlabProjects } from "@/lib/db/schema";
import { SCHOOL } from "@/lib/config";
import { dayKey } from "@/lib/dates";
import { getSetting, setSetting } from "@/lib/settings";
import { getPlanning, planningSprints } from "./planning";
import { PROJECT_CHECKS } from "./portfolio";

// The team's docs site (MkDocs on GitLab Pages) next to the docs a project
// like this should have. MkDocs publishes a search index with every page and
// section, so no scraping and no AI: pages are matched by their path.

const DOCS_KEY = "school_docs";
const CHECKS_KEY = "school_project_checks";
const MAX_AGE_MS = 6 * 3_600_000;

type IndexDoc = { location: string; title: string; text: string };
type Docs = { fetchedAt: string; docs: IndexDoc[] };

type Expect = {
  id: string;
  group: "Project" | "Scrum" | "Onderzoek" | "Ontwerp" | "Techniek";
  title: string;
  what: string;
  /** Matches a path segment that contains one of these ("technisch/testen/" → "testen"). */
  paths: string[];
  /** Headings (or words in the text) the page should have. */
  sections: { title: string; words: string[] }[];
  perSprint?: number;
};

const EXPECTED: Expect[] = [
  {
    id: "home", group: "Project", title: "Startpagina", what: "Wat Kova is, wie in het team zit en waar alles staat.", paths: [""],
    sections: [{ title: "Stand van zaken", words: ["stand van zaken"] }, { title: "Team", words: ["team"] }, { title: "Waar vind je wat", words: ["waar vind"] }],
  },
  {
    id: "projectplan", group: "Project", title: "Projectplan", what: "Probleem, stakeholders, behoeften en de gekozen oplossing (AA1, AA2, AA6).", paths: ["projectplan"],
    sections: [
      { title: "Probleemstelling", words: ["probleem"] },
      { title: "Feiten en aannames", words: ["aanname"] },
      { title: "Stakeholders", words: ["stakeholder"] },
      { title: "Behoefte en interviews", words: ["behoefte", "interview"] },
      { title: "MoSCoW", words: ["moscow"] },
      { title: "Wet- en regelgeving (AVG, AI Act)", words: ["wet", "regelgeving", "avg", "ai act"] },
      { title: "Oplossing", words: ["oplossing"] },
    ],
  },
  {
    id: "agreements", group: "Project", title: "Samenwerkingsafspraken", what: "Hoe het team samenwerkt (MS4).", paths: ["samenwerkingsafspraken"],
    sections: [
      { title: "Teamcanvas", words: ["teamcanvas"] },
      { title: "Git-afspraken", words: ["git"] },
      { title: "Rollen (scrum master, PO-contact)", words: ["rol", "scrum master"] },
      { title: "Conflicten en vertraging", words: ["conflict", "vertraging", "aanspreken"] },
    ],
  },
  {
    id: "dod", group: "Project", title: "Definition of Done", what: "De checklist wanneer werk af is, voor elk item (MS5, OR2).", paths: ["definition-of-done", "dod"],
    sections: [{ title: "De checklist", words: ["review", "getest", "test"] }, { title: "Hoe we hem gebruiken", words: ["merge request", "gebruik"] }],
  },
  {
    id: "stories", group: "Project", title: "User stories", what: "Het format en de afspraken voor stories (OR4).", paths: ["user-stories"],
    sections: [{ title: "Template", words: ["template"] }, { title: "Acceptatiecriteria", words: ["acceptatiecriteria"] }],
  },
  {
    id: "stakeholder-feedback", group: "Project", title: "Terugkoppeling aan stakeholders", what: "Per interview of review wat jullie hoorden en wat jullie ermee doen (AA2).", paths: ["terugkoppeling", "stakeholder"],
    sections: [{ title: "Bevindingen", words: ["bevinding"] }, { title: "Wat we ermee doen", words: ["aanpass", "actie"] }],
  },
  {
    id: "sprintplanning", group: "Scrum", title: "Sprintplanning", what: "Sprintdoel en de stories van die sprint (MS3).", paths: ["planning"], perSprint: 1,
    sections: [{ title: "Sprintdoel", words: ["sprintdoel"] }, { title: "Stories en taakverdeling", words: ["stories", "issue", "taak"] }],
  },
  {
    id: "sprint-review", group: "Scrum", title: "Sprint review", what: "Wat jullie lieten zien, de feedback en wat dat betekent voor de backlog (MS3, AA6).", paths: ["sprint-review", "sprintreview", "review"], perSprint: 0,
    sections: [{ title: "Opgeleverd (volgens DoD)", words: ["opgeleverd", "demo"] }, { title: "Feedback stakeholders", words: ["feedback"] }, { title: "Vervolg / backlog", words: ["backlog", "vervolg"] }],
  },
  {
    id: "retro", group: "Scrum", title: "Retrospective", what: "Terugblik op de sprint met actiepunten (MS3, MS4).", paths: ["retrospective", "retro"], perSprint: 1,
    sections: [{ title: "Wat ging goed / kan beter", words: ["goed"] }, { title: "Teamcontract", words: ["teamcontract", "samenwerking"] }, { title: "Actiepunten", words: ["actiepunt"] }],
  },
  {
    id: "research", group: "Onderzoek", title: "Onderzoek per user story", what: "Per teamlid minstens één onderzoek bij een story (AA3, AA5).", paths: ["onderzoek"],
    sections: [
      { title: "Vraag", words: ["vraag"] },
      { title: "Methode", words: ["methode"] },
      { title: "Criteria", words: ["criteria"] },
      { title: "Resultaten", words: ["resultaten"] },
      { title: "Conclusie en keuze", words: ["conclusie", "keuze"] },
      { title: "AI-gebruik", words: ["ai gebruik"] },
      { title: "Bronnen (APA)", words: ["bronnen", "apa"] },
    ],
  },
  {
    id: "design", group: "Ontwerp", title: "Ontwerp en ontwerpkeuzes", what: "Wireframes, prototype en waarom het zo is ontworpen (OR4).", paths: ["ontwerp"],
    sections: [{ title: "Wireframes", words: ["wireframe"] }, { title: "Prototype", words: ["prototype"] }, { title: "Ontwerpkeuzes", words: ["keuze"] }, { title: "Feedback op de ontwerpen", words: ["feedback"] }],
  },
  {
    id: "roles", group: "Ontwerp", title: "Rollen en rechten", what: "Wie mag wat in de app (OR3, secure by design).", paths: ["rollen", "portfolios"],
    sections: [{ title: "Wie mag wat", words: ["wie mag"] }],
  },
  {
    id: "usertest", group: "Ontwerp", title: "Gebruikerstest", what: "Test met eindgebruikers: opzet, resultaten en conclusies (AA5, OR6).", paths: ["gebruikerstest", "usertest"],
    sections: [{ title: "Opzet", words: ["opzet", "taken"] }, { title: "Resultaten", words: ["resultaten"] }, { title: "Conclusies en nieuwe stories", words: ["conclusie"] }],
  },
  {
    id: "ethics", group: "Ontwerp", title: "Ethiek", what: "Waarden, SDG en risico's van het product en van AI (PL5, PL6).", paths: ["ethiek"],
    sections: [{ title: "Waarden en SDG", words: ["sdg", "waarde"] }, { title: "Risico's", words: ["risico"] }],
  },
  {
    id: "architecture", group: "Techniek", title: "Architectuur (UML)", what: "Het hele systeem van boven naar beneden, met alle verbindingen (OR3).", paths: ["architectuur"],
    sections: [
      { title: "Overzicht (plaat)", words: ["overzicht"] },
      { title: "Systeemflow", words: ["flow"] },
      { title: "Onderdelen", words: ["onderdelen"] },
      { title: "UML-klassendiagram", words: ["klassendiagram", "uml"] },
      { title: "Security / wie mag wat", words: ["security", "wie mag"] },
    ],
  },
  {
    id: "database", group: "Techniek", title: "Database (ERD)", what: "Datamodel met tabellen en relaties (OR1, OR3).", paths: ["database"],
    sections: [{ title: "Datamodel / ERD", words: ["datamodel", "erd"] }, { title: "Relaties", words: ["relatie"] }],
  },
  {
    id: "security", group: "Techniek", title: "Security en authenticatie", what: "Hoe inloggen en data beveiligd zijn, en de risico's (OR3, PL6).", paths: ["security", "authenticatie"],
    sections: [{ title: "Wachtwoorden en sessies", words: ["wachtwoord", "sessie"] }, { title: "Bekende risico's", words: ["risico"] }],
  },
  {
    id: "privacy", group: "Techniek", title: "Privacyverklaring (AVG)", what: "Welke gegevens, waarom en hoe lang (AA4).", paths: ["privacy"],
    sections: [{ title: "Welke gegevens en waarom", words: ["gegevens"] }, { title: "Bewaartermijn", words: ["bewaren", "lang"] }],
  },
  {
    id: "choices", group: "Techniek", title: "Technische keuzes", what: "Waarom deze stack, met alternatieven (AA6, OR6).", paths: ["technische-keuzes", "keuzes"], sections: [],
  },
  {
    id: "api", group: "Techniek", title: "API", what: "Alle endpoints met in- en uitvoer.", paths: ["api"], sections: [],
  },
  {
    id: "frontend", group: "Techniek", title: "Frontend", what: "Pagina's, flows en toegankelijkheid.", paths: ["frontend"], sections: [],
  },
  {
    id: "tests", group: "Techniek", title: "Testen (protocol en rapport)", what: "Hoe er getest wordt en wat eruit kwam (OR6).", paths: ["testen", "test"],
    sections: [{ title: "Unit tests", words: ["unit"] }, { title: "End-to-end", words: ["end to end", "e2e"] }, { title: "Handmatige tests", words: ["handmatig"] }, { title: "Testrapport (resultaten)", words: ["rapport", "resultaten"] }],
  },
  {
    id: "deploy", group: "Techniek", title: "Deployment en CI/CD", what: "Hoe het product live komt, eventueel met pipeline (OR2, MS2).", paths: ["deploy", "ci-cd", "pipeline", "hosting"],
    sections: [{ title: "Waar het draait", words: ["server", "pages", "hosting"] }, { title: "Pipeline", words: ["pipeline", "gitlab ci"] }],
  },
  {
    id: "setup", group: "Techniek", title: "Aan de slag", what: "Hoe een nieuw teamlid het project lokaal draait.", paths: ["aan-de-slag"], sections: [],
  },
];

const GROUP_OF: Record<string, Expect["group"]> = { project: "Project", technisch: "Techniek", onderzoek: "Onderzoek", ontwerp: "Ontwerp" };

const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
const norm = (s: string) => ` ${strip(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()}`;
const has = (text: string, words: string[]) => words.some((w) => text.includes(norm(w)));
const sprintOf = (s: string) => {
  const m = /sprint[\s_-]*(\d+)/i.exec(s);
  return m ? Number(m[1]) : null;
};

async function getDocs(): Promise<Docs | null> {
  const cached = await getSetting<Docs>(DOCS_KEY);
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < MAX_AGE_MS) return cached;
  try {
    const res = await fetch(new URL("search/search_index.json", SCHOOL.docsUrl), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const docs = { fetchedAt: new Date().toISOString(), docs: ((await res.json()) as { docs: IndexDoc[] }).docs };
    await setSetting(DOCS_KEY, docs);
    return docs;
  } catch (err) {
    console.error("[school] docs fetch failed", err);
    return cached ?? null;
  }
}

export type DocPage = { url: string; location: string; title: string; sections: { title: string; excerpt: string }[] };
export type DocItem = {
  id: string;
  title: string;
  what: string;
  state: "have" | "todo" | "extra";
  pages: DocPage[];
  /** Expected headings and whether the page has them. */
  checks: { title: string; ok: boolean }[];
};
export type ProjectOverview = Awaited<ReturnType<typeof projectOverview>>;

export async function projectOverview(today = dayKey()) {
  const [docs, planning, checked, issues] = await Promise.all([
    getDocs(),
    getPlanning(),
    getSetting<string[]>(CHECKS_KEY),
    db
      .select({ id: gitlabItems.externalId, title: gitlabItems.title, state: gitlabItems.state, mine: gitlabItems.mine, url: gitlabItems.url, labels: gitlabItems.labels, milestone: gitlabItems.milestone, project: gitlabProjects.name })
      .from(gitlabItems)
      .innerJoin(gitlabProjects, eq(gitlabProjects.id, gitlabItems.projectId))
      .where(and(eq(gitlabItems.type, "issue"), eq(gitlabProjects.kind, "school")))
      .orderBy(asc(gitlabItems.happenedAt)),
  ]);
  const sprints = planningSprints(planning).filter((s) => s.number <= 4 && s.start <= today);

  // Pages with their sections, from the flat search index.
  const all = docs?.docs ?? [];
  const pages: (DocPage & { text: string })[] = all
    .filter((d) => !d.location.includes("#"))
    .map((d) => {
      const sections = all.filter((s) => s.location.startsWith(`${d.location}#`));
      return {
        url: new URL(d.location, SCHOOL.docsUrl).toString(),
        location: d.location,
        title: strip(d.title),
        sections: sections.map((s) => ({ title: strip(s.title), excerpt: strip(s.text).slice(0, 220) })).filter((s) => s.title),
        text: norm(`${d.title} ${d.text} ${sections.map((s) => `${s.title} ${s.text}`).join(" ")}`),
      };
    });

  const toPage = (p: DocPage): DocPage => ({ url: p.url, location: p.location, title: p.title, sections: p.sections });
  const used = new Set<string>();
  const segmentHit = (p: { location: string }, paths: string[]) =>
    paths.some((t) => (t === "" ? p.location === "" : p.location.toLowerCase().split("/").some((seg) => seg.includes(t))));
  const groups = new Map<Expect["group"] | "Overig", DocItem[]>();
  const push = (group: Expect["group"] | "Overig", item: DocItem) => groups.set(group, [...(groups.get(group) ?? []), item]);

  for (const e of EXPECTED) {
    const rows = e.perSprint === undefined ? [{ sprint: null as number | null, title: e.title }] : sprints.filter((s) => s.number >= e.perSprint!).map((s) => ({ sprint: s.number as number | null, title: `${e.title} ${s.name.toLowerCase()}` }));
    for (const row of rows) {
      const found = pages.filter((p) => !used.has(p.location) && segmentHit(p, e.paths) && (row.sprint === null || sprintOf(`${p.location} ${p.title}`) === row.sprint));
      found.forEach((p) => used.add(p.location));
      const checks = e.sections.map((s) => ({ title: s.title, ok: found.some((p) => has(p.text, s.words)) }));
      push(e.group, { id: row.sprint === null ? e.id : `${e.id}:${row.sprint}`, title: row.title, what: e.what, state: found.length ? "have" : "todo", pages: found.map(toPage), checks });
    }
  }
  for (const p of pages.filter((p) => !used.has(p.location))) {
    push(GROUP_OF[p.location.split("/")[0]] ?? "Overig", { id: `page:${p.location}`, title: p.title, what: "", state: "extra", pages: [toPage(p)], checks: [] });
  }

  // Issues per sprint (GitLab milestones "Sprint N"), backlog last.
  const bySprint = new Map<string, typeof issues>();
  for (const i of issues) bySprint.set(i.milestone ?? "Backlog", [...(bySprint.get(i.milestone ?? "Backlog") ?? []), i]);
  const order = (m: string) => (m === "Backlog" ? 999 : (sprintOf(m) ?? 500));
  const done = new Set(checked ?? []);

  return {
    docsUrl: SCHOOL.docsUrl,
    fetchedAt: docs?.fetchedAt ?? null,
    groups: [...groups.entries()].map(([group, items]) => ({ group, items })),
    issues: [...bySprint.entries()].sort(([a], [b]) => order(a) - order(b)).map(([milestone, list]) => ({ milestone, issues: list })),
    checks: PROJECT_CHECKS.map((p) => ({ ...p, done: done.has(p.id) })),
  };
}

export async function setProjectCheck(id: string, done: boolean) {
  if (!PROJECT_CHECKS.some((p) => p.id === id)) return false;
  const current = new Set((await getSetting<string[]>(CHECKS_KEY)) ?? []);
  if (done) current.add(id);
  else current.delete(id);
  await setSetting(CHECKS_KEY, [...current]);
  return true;
}
