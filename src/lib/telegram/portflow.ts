import { PORTFLOW } from "@/lib/config";
import { dayKey } from "@/lib/dates";
import { sendPrompt } from "@/lib/coach/prompts";
import { importEvidence, portflowReport, readScreenshot, reportText } from "@/lib/school/portflow";
import { draftSprintDoc, pickSprint, SPRINT_DOC_LABEL, type SprintDocKind } from "@/lib/school/sprint-doc";
import { downloadFile, sendDocument, sendMessage, sendTyping, type InlineButton, type TelegramMessage } from "./api";

// Portflow screenshots and sprint documents in Telegram. After /portflow (or
// the reminder's button) every image for PORTFLOW.waitMinutes is read as a
// screenshot of "Mijn bewijs" instead of going to Drive; a photo with
// "portflow" in its caption works any time. In memory only, like ➕ Taak.

const state = ((globalThis as unknown as { __portflow?: { until: number; timer: NodeJS.Timeout | null; batch: { read: number; added: number; marked: string[] } } }).__portflow ??= {
  until: 0,
  timer: null,
  batch: { read: 0, added: 0, marked: [] },
});

export function expectScreenshots() {
  state.until = Date.now() + PORTFLOW.waitMinutes * 60_000;
}

export function stopExpecting() {
  state.until = 0;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

/** Is this message a Portflow screenshot? Then it's handled here and not filed in Drive. */
export function isPortflowShot(msg: TelegramMessage) {
  const image = Boolean(msg.photo?.length) || IMAGE_TYPES.includes(msg.document?.mime_type as ImageType);
  return image && (state.until > Date.now() || /portflow/i.test(msg.caption ?? ""));
}

export async function handleScreenshot(msg: TelegramMessage) {
  const chatId = msg.chat.id;
  // Each screenshot of an album is its own message; the wait is extended per screenshot.
  expectScreenshots();
  await sendTyping(chatId);
  const photo = msg.photo?.at(-1);
  const buffer = await downloadFile(photo?.file_id ?? msg.document!.file_id);
  const mediaType: ImageType = photo ? "image/jpeg" : (msg.document!.mime_type as ImageType);
  const rows = await readScreenshot(buffer, mediaType);
  if (rows.length === 0) {
    return sendMessage(chatId, "Op deze screenshot kon ik geen rijen van Mijn bewijs lezen. Zoom iets in (of stuur hem als bestand, dan blijft hij scherp) en probeer opnieuw.");
  }
  const result = await importEvidence(rows);
  state.batch.read += result.read;
  state.batch.added += result.added;
  state.batch.marked.push(...result.marked);

  // One report for the whole batch, a little after the last screenshot.
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    const batch = state.batch;
    state.batch = { read: 0, added: 0, marked: [] };
    sendReport(chatId, batch).catch((err) => console.error("[portflow] report failed", err));
  }, PORTFLOW.reportDelayMs);
}

function reportButtons(id: string): InlineButton[][] {
  return [
    [
      { text: "💡 Tips", data: `c:${id}:tips` },
      { text: "📝 Sprint Review", data: `c:${id}:review` },
    ],
    [
      { text: "🔁 Retrospective", data: `c:${id}:retro` },
      { text: "📸 Meer screenshots", data: `c:${id}:shots` },
    ],
  ];
}

/** The check, with buttons; after screenshots it starts with what was read. */
export async function sendReport(chatId: number, batch?: { read: number; added: number; marked: string[] }, opts: { skipEmpty?: boolean } = {}) {
  const report = await portflowReport();
  if (report.total === 0 && opts.skipEmpty) return;
  const intro = batch
    ? `✓ ${batch.read} rijen gelezen, ${batch.added} nieuw.${batch.marked.length ? ` In je roadmap op "in Portflow" gezet: ${[...new Set(batch.marked)].join(", ")}.` : ""}\n\n`
    : "";
  const text = intro + reportText(report);
  if (report.total === 0) return sendMessage(chatId, text);
  // Unique key: every report is its own prompt, so older buttons keep working.
  await sendPrompt({ kind: "portflow_report", dedupKey: `portflow_report:${Date.now()}`, text, buttons: reportButtons });
}

/** /sprintreview [n] [notes] and /retro [n] [notes]: a first draft as a .md file. */
export async function sendSprintDoc(chatId: number, kind: SprintDocKind, args = "") {
  const match = /^(\d+)\s*/.exec(args);
  const notes = match ? args.slice(match[0].length).trim() : args.trim();
  const sprint = await pickSprint(match ? Number(match[1]) : null, dayKey());
  if (!sprint) {
    return sendMessage(chatId, match ? `Sprint ${match[1]} ken ik niet (uit de GitLab-milestones).` : "Geen sprints gevonden in GitLab (milestones \"Sprint 1\", …).");
  }
  await sendMessage(chatId, `✍️ ${SPRINT_DOC_LABEL[kind]} voor ${sprint.name} schrijven, dat duurt een halve minuut…`);
  await sendTyping(chatId);
  const doc = await draftSprintDoc(kind, sprint, notes);
  const caption = `${SPRINT_DOC_LABEL[kind]} ${sprint.name}: concept uit GitLab, agenda en Portflow.${
    doc.todo ? ` Vul de ${doc.todo} [aanvullen]-plekken aan met je team.` : ""
  }${notes ? "" : `\nTip: geef notities mee, bv. /${kind === "review" ? "sprintreview" : "retro"} ${sprint.number} PO wilde eerst de login`}`;
  await sendDocument(chatId, doc.fileName, doc.markdown, caption);
}
