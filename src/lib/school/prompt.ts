import type { MirrorRow } from "./mirror";
import type { DocItem } from "./project";

// Ready-to-paste prompts to make a piece of evidence or a docs page. Built in
// code from what the hub already knows, so no AI call (and no tokens) here.

const CONTEXT =
  "Ik ben Piet-Hein, eerstejaars HBO-ICT aan de HvA (propedeuse semester 1, ICT In Action, 2026-2027). " +
  "Ons teamproject is Kova: een webapp waarmee creatieve starters zonder code een eigen portfolio bouwen en publiceren (Next.js-frontend, backend met Prisma/Postgres, AI-hulp bij het canvas).";

const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");

export function evidencePrompt(row: MirrorRow, collection: string, goal: string) {
  const have = row.evidence.map((e) => e.name);
  if (row.type === "link") {
    // A link has no document to write: the code link plus the feedback, neatly written.
    return [
      CONTEXT,
      "",
      `Bewijs voor Portflow: "${row.title}" (losse link). Collectie: ${collection}. Leerdoel: ${goal}${row.sub ? `, subdoel ${row.sub}` : ""}.`,
      `Wat het is: ${row.what}`,
      "",
      row.feedback
        ? "Zoek de beste link naar mijn eigen code/merge requests en schrijf de feedback hieronder netjes uit als Portflow-comment."
        : "Zoek de beste link naar mijn eigen werk en schrijf er 2 zinnen bij wat het laat zien.",
      ...(row.feedback ? ["", `Feedback (van ${row.feedback.who.split(":")[0]}): zoek die in mijn notities; staat hij er niet, zet hier wat ik kreeg:`, "- "] : []),
    ].join("\n");
  }
  return [
    CONTEXT,
    "",
    `Help me met dit bewijs voor mijn Portflow-portfolio: "${row.title}".`,
    `Collectie: ${collection}. Leerdoel: ${goal}${row.sub ? `, subdoel ${row.sub}` : ""}. Vorm: ${row.type === "link" ? "een losse link (bijvoorbeeld naar GitLab of de docs-site)" : "een document dat ik upload"}.`,
    "",
    `Wat het is: ${row.what}`,
    "",
    "Wat erin moet:",
    list(row.content),
    have.length ? `\nIk heb nu al: ${have.join("; ")}. Kijk wat daaraan ontbreekt en vul het aan.` : "",
    row.feedback ? `\nHier is feedback nodig van: ${row.feedback.who}. Geef me ook 2-3 gerichte vragen om die feedback te vragen.` : "",
    "",
    "Zoek zelf op wat je nodig hebt in het project, mijn notities, GitLab en Portflow. Schrijf het stuk kort en concreet, plus een titel voor Portflow en een beschrijving van 2 zinnen die uitlegt wat het bewijs laat zien.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function docsPrompt(item: DocItem, docsUrl: string) {
  const missing = item.checks.filter((c) => !c.ok).map((c) => c.title);
  const page = item.pages[0];
  return [
    CONTEXT,
    "",
    page
      ? `Werk deze pagina van onze MkDocs-documentatie bij: "${item.title}" (${page.url}).`
      : `Schrijf een nieuwe pagina voor onze MkDocs-documentatie (${docsUrl}): "${item.title}".`,
    item.what ? `Doel van de pagina: ${item.what}` : "",
    page && page.sections.length ? `\nDe pagina heeft nu deze koppen:\n${list(page.sections.map((s) => s.title))}` : "",
    item.checks.length ? `\n${page ? "Wat er nog mist" : "Wat erin moet"}:\n${list(page ? missing : item.checks.map((c) => c.title))}` : "",
    "",
    "Schrijf het als Markdown voor MkDocs (Material): één # titel, ## per onderdeel, tabellen waar dat helpt, Mermaid-diagrammen voor schema's. Nederlands, kort en concreet. Haal alles uit de code, de bestaande docs en mijn notities; verzin geen feiten over ons project.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
