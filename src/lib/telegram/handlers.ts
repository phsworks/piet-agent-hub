import { getSetting, setSetting } from "@/lib/settings";
import { runAssistant } from "@/lib/assistant/run";
import { addMessage, conversationExists, createConversation, recentHistory } from "@/lib/assistant/conversation";
import { saveMemory } from "@/lib/memory/store";
import { enqueueUpload } from "@/lib/files/ingest";
import { getGoogleStatus } from "@/lib/google/auth";
import { TIMEZONE } from "@/lib/config";
import { createTask } from "@/lib/ticktick/client";
import { TickTickNotConnectedError } from "@/lib/ticktick/auth";
import { formatDue, parseQuickTask, todayOverview, weekOverview } from "./quick";
import { BUTTONS, MAIN_KEYBOARD } from "./keyboard";
import { describeGoal, progressLine, weekProgress } from "@/lib/coach/goals";
import { isCoachPaused, keyExists, setCoachPaused } from "@/lib/coach/prompts";
import { morningCheckin } from "@/lib/coach/checkins";
import { dayKey } from "@/lib/dates";
import { allProgress, findProject, progressDetail, progressSummary, projectProgress } from "@/lib/gitlab/progress";
import { findSchoolItem } from "@/lib/school/roadmap";
import { schoolOverview, schoolPicture } from "@/lib/school/priorities";
import { sendItemCard } from "@/lib/school/nudge";
import {
  MAX_DOWNLOAD_BYTES,
  downloadFile,
  ownerChatId,
  sendMessage,
  sendTyping,
  type TelegramMessage,
} from "./api";

const CONVERSATION_KEY = "telegram_conversation_id";
// Telegram's "typing…" status lasts 5 seconds; refresh it while the assistant works.
const TYPING_REFRESH_MS = 4_500;

// After ➕ Taak / 📝 Notitie, the next message is the task or note.
// In memory only: a restart simply forgets a half-finished button press.
const PENDING_MS = 10 * 60_000;
type PendingKind = "task" | "note" | "feedback";
let pending: { kind: PendingKind; until: number } | null = null;

const PENDING_PROMPTS: Record<PendingKind, { prompt: string; command: string }> = {
  task: { prompt: 'Welke taak? Bv. "morgen 9:00 mail docent"', command: "/t" },
  note: { prompt: "Wat wil je onthouden?", command: "/n" },
  feedback: { prompt: "Wat stoort je of wil je anders? Wat ik zelf kan aanpassen doe ik meteen.", command: "/fb" },
};

const HELP = `Stuur me gewoon een bericht:
- een vraag: "waar staat de rubric van semester 3?", "wat moet ik deze week doen?"
- iets om te onthouden: "onthoud dat mijn kluiscode 4821 is"
- een herinnering: "herinner me vrijdag aan het reflectieverslag" (komt in TickTick)
- plannen: "plan woensdagavond een uur hardlopen"
- school: "waar moet ik aan werken?", "retrospective is af", "CI/CD staat in Portflow"
- een foto, PDF of ander bestand: ik zet het in Drive en maak het doorzoekbaar (een bijschrift helpt bij het opbergen)

- een tech-vraag: "hoe werkt een REST API eigenlijk?", "waarom is mijn query traag?"

Knoppen onderin: 📅 Vandaag, 🗓 Week, 🎯 Doelen, 🎓 School, ➕ Taak, 📝 Notitie, 🛠 Feedback (iets aan mij dat je stoort).

Coach: elke ochtend (07:30) een check-in met een tech-feitje, 's avonds (21:00) afvinken, zondag (19:00) een weekreview, en tussendoor een seintje als een deadline nadert of een doel achterloopt. Doelen stel je in door het te zeggen: "ik wil 3× per week hardlopen, 's ochtends".

Commando's:
/week: de komende 7 dagen (zonder AI, gratis)
/doelen: je doelen en hoe je ervoor staat
/school of /school <naam>: je roadmap, waar je nu aan kunt werken en wat nog in Portflow moet; met een naam de details en knoppen om de status te zetten (zonder AI, gratis)
/project of /project <naam>: voortgang van je GitLab-projecten, bv. /project kova (zonder AI, gratis)
/coach uit of /coach aan: check-ins en seintjes pauzeren
/coach nu: de ochtend-check-in nu al (als die vandaag nog niet kwam)
/t <taak>: meteen in TickTick, bv. /t morgen 9:00 mail docent (zonder AI, gratis)
/vandaag: je afspraken en taken van vandaag (zonder AI, gratis)
/n <tekst>: meteen opslaan als notitie (zonder AI, gratis)
/uitleg <onderwerp>: tech-uitleg, bv. /uitleg hoe werkt OAuth
/fb <tekst>: feedback over de bot of coach (wat kan, pas ik meteen aan)
/diep <vraag>: zwaarder model voor lastige vragen
/nieuw: nieuw gesprek (vergeet de vorige berichten)`;

export async function handleMessage(msg: TelegramMessage) {
  const chatId = msg.chat.id;
  const owner = ownerChatId();

  if (!owner) {
    await sendMessage(
      chatId,
      `Hoi! Je chat-id is ${chatId}.\n\nZet in .env.local:\nTELEGRAM_CHAT_ID=${chatId}\n\nen herstart de app (npm run service update). Daarna reageer ik alleen nog op jou.`
    );
    return;
  }
  // Anyone can find a bot by name; only Piet gets answers.
  if (chatId !== owner) return;

  try {
    if (msg.photo?.length || msg.document) {
      await handleFile(msg);
    } else if (msg.text) {
      await handleText(chatId, msg.text.trim());
    } else if (msg.voice || msg.audio || msg.video) {
      await sendMessage(chatId, "Spraak en video kan ik nog niet verwerken. Typ het even, of stuur een foto of document.");
    }
  } catch (err) {
    console.error("Telegram message failed", err);
    await sendMessage(chatId, "Er ging iets mis. Kijk in ~/Library/Logs/piet-brain.log.").catch(() => {});
  }
}

async function handleText(chatId: number, text: string) {
  // A button press is just its label as text; map it onto the command.
  if (text === BUTTONS.today) text = "/vandaag";
  else if (text === BUTTONS.week) text = "/week";
  else if (text === BUTTONS.goals) text = "/doelen";
  else if (text === BUTTONS.school) text = "/school";
  else if (text === BUTTONS.task || text === BUTTONS.note || text === BUTTONS.feedback) {
    const kind: PendingKind = text === BUTTONS.task ? "task" : text === BUTTONS.note ? "note" : "feedback";
    pending = { kind, until: Date.now() + PENDING_MS };
    return sendMessage(chatId, PENDING_PROMPTS[kind].prompt);
  }

  // The message after ➕/📝/🛠 is the content, unless it's a command or the wait expired.
  const waiting = pending && pending.until > Date.now() && !text.startsWith("/") ? pending.kind : null;
  pending = null;
  if (waiting) text = `${PENDING_PROMPTS[waiting].command} ${text}`;

  const [command] = text.split(/\s+/);
  const args = text.slice(command.length).trim();

  switch (command.toLowerCase().replace(/@\w+$/, "")) {
    case "/start":
    case "/help":
      return sendMessage(chatId, HELP, MAIN_KEYBOARD);
    case "/nieuw":
      await setSetting(CONVERSATION_KEY, null);
      return sendMessage(chatId, "Nieuw gesprek gestart.");
    case "/n":
    case "/notitie": {
      if (!args) return sendMessage(chatId, "Gebruik: /n <tekst>");
      const result = await saveMemory({ content: args, category: "note", source: "telegram" });
      return sendMessage(chatId, result.action === "updated" ? "✓ Bijgewerkt (leek op een bestaande notitie)" : "✓ Opgeslagen");
    }
    case "/t":
    case "/taak": {
      if (!args) return sendMessage(chatId, "Gebruik: /t <taak>, bv. /t vrijdag 17:00 verslag inleveren");
      const parsed = parseQuickTask(args);
      try {
        const task = await createTask(parsed);
        return sendMessage(chatId, `✓ In TickTick (${task.list}): ${task.title}, ${formatDue(parsed.dueDay, parsed.dueTime)}`);
      } catch (err) {
        if (err instanceof TickTickNotConnectedError) return sendMessage(chatId, err.message);
        throw err;
      }
    }
    case "/vandaag":
      return sendMessage(chatId, await todayOverview());
    case "/week":
      return sendMessage(chatId, await weekOverview());
    case "/doelen":
      return sendMessage(chatId, await goalsOverview());
    case "/project":
    case "/projecten":
      return sendMessage(chatId, await projectsOverview(args));
    case "/school":
      return schoolCommand(chatId, args);
    case "/coach": {
      const wanted = args.toLowerCase();
      // Try the check-in now instead of waiting for tomorrow morning.
      if (wanted === "nu") {
        if (await keyExists(`morning:${dayKey()}`)) return sendMessage(chatId, "De check-in van vandaag is al verstuurd.");
        await sendTyping(chatId);
        return morningCheckin();
      }
      if (wanted === "uit" || wanted === "aan") await setCoachPaused(wanted === "uit");
      const paused = await isCoachPaused();
      return sendMessage(
        chatId,
        paused
          ? "⏸ De coach staat uit: geen check-ins of seintjes. Zet hem weer aan met /coach aan."
          : "▶️ De coach staat aan. Pauzeren kan met /coach uit."
      );
    }
    case "/fb":
    case "/feedback":
      if (!args) return sendMessage(chatId, "Gebruik: /fb <wat je stoort of anders wilt>");
      // Via the assistant: it applies what a setting can fix and logs the rest.
      return ask(chatId, `Feedback over de hub: ${args}`, false);
    case "/uitleg":
      if (!args) return sendMessage(chatId, "Gebruik: /uitleg <onderwerp>, bv. /uitleg hoe werkt OAuth");
      return ask(chatId, `Leg uit als mijn development buddy: ${args}`, false);
    case "/diep":
      if (!args) return sendMessage(chatId, "Gebruik: /diep <vraag>");
      return ask(chatId, args, true);
    default:
      if (command.startsWith("/")) {
        return sendMessage(chatId, `Onbekend commando.\n\n${HELP}`);
      }
      return ask(chatId, text, false);
  }
}

async function goalsOverview() {
  const progress = await weekProgress();
  if (progress.length === 0) {
    return 'Nog geen doelen. Zeg bijvoorbeeld: "ik wil 3× per week hardlopen, \'s ochtends, een uur".';
  }
  const lines = ["🎯 Deze week"];
  for (const p of progress) lines.push(`- ${progressLine(p)}`);
  lines.push("", "Ingesteld:", ...progress.map((p) => `- ${describeGoal(p.goal)}`));
  if (await isCoachPaused()) lines.push("", "⏸ De coach staat uit (/coach aan).");
  return lines.join("\n");
}

async function projectsOverview(name: string) {
  if (name) {
    const project = await findProject(name);
    return project ? progressDetail(await projectProgress(project)) : `Geen (uniek) project gevonden voor "${name}". Probeer /project zonder naam.`;
  }
  const all = await allProgress();
  if (all.length === 0) return "Nog geen GitLab-projecten gevolgd. Kies ze in Settings.";
  return ["📈 Laatste 7 dagen", ...all.map((p) => `- ${progressSummary(p)}`), "", "Details: /project <naam>"].join("\n");
}

async function schoolCommand(chatId: number, name: string) {
  if (!name) return sendMessage(chatId, schoolOverview(await schoolPicture()));
  const { item, candidates } = await findSchoolItem(name);
  if (item) return sendItemCard(item);
  if (candidates.length) {
    return sendMessage(chatId, `Welke bedoel je?\n${candidates.slice(0, 8).map((c) => `- /school ${c.title}`).join("\n")}`);
  }
  return sendMessage(chatId, `Niets gevonden voor "${name}". /school laat alles zien.`);
}

async function ask(chatId: number, question: string, deep: boolean) {
  let conversationId = await getSetting<string | null>(CONVERSATION_KEY);
  if (!conversationId || !(await conversationExists(conversationId))) {
    conversationId = await createConversation(`Telegram: ${question}`);
    await setSetting(CONVERSATION_KEY, conversationId);
  }

  await addMessage(conversationId, "user", question);
  const history = await recentHistory(conversationId);

  await sendTyping(chatId);
  const typing = setInterval(() => sendTyping(chatId), TYPING_REFRESH_MS);
  try {
    const result = await runAssistant({ messages: history, deep, source: "telegram" });
    await addMessage(conversationId, "assistant", result.text);
    await sendMessage(chatId, result.text);
  } finally {
    clearInterval(typing);
  }
}

async function handleFile(msg: TelegramMessage) {
  const chatId = msg.chat.id;
  const google = await getGoogleStatus();
  if (!google.connected) {
    return sendMessage(chatId, "Google is niet gekoppeld, dus ik kan niets in Drive zetten. Koppel het in Settings.");
  }

  // Telegram sends a photo in several sizes; the last one is the largest.
  const photo = msg.photo?.at(-1);
  const fileId = photo?.file_id ?? msg.document!.file_id;
  const size = photo?.file_size ?? msg.document?.file_size;
  if (size && size > MAX_DOWNLOAD_BYTES) {
    return sendMessage(chatId, "Dat bestand is groter dan 20 MB; dat kan een Telegram-bot niet downloaden. Zet het direct in Drive of upload het in de web-app.");
  }

  const name = photo ? `Foto ${timestamp(msg.date)}.jpg` : (msg.document!.file_name ?? `Bestand ${timestamp(msg.date)}`);
  const buffer = await downloadFile(fileId);
  const result = await enqueueUpload({
    buffer,
    name,
    mimeType: photo ? "image/jpeg" : msg.document?.mime_type,
    source: "telegram",
    note: msg.caption?.trim() || null,
  });

  if (result.duplicates > 0 && result.queued === 0) {
    return sendMessage(chatId, "Dit bestand heb ik al.");
  }
  if (result.queued === 0) {
    return sendMessage(chatId, "Hier kon ik niets mee (leeg bestand?).");
  }
  // The file worker sends a message when it's filed and indexed.
  await sendMessage(chatId, result.queued > 1 ? `📥 ${result.queued} bestanden ontvangen, ik verwerk ze…` : "📥 Ontvangen, ik verwerk het…");
}

function timestamp(unixSeconds: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(unixSeconds * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}.${get("minute")}`;
}
