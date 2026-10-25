import { getSetting, setSetting } from "@/lib/settings";
import { botToken, callTelegram, TelegramError, type TelegramUpdate } from "./api";
import { handleMessage } from "./handlers";
import { handleCallback } from "./callbacks";
import { startPresence } from "./presence";
import { ensureKeyboard } from "./keyboard";

const OFFSET_KEY = "telegram_update_offset";
// Long polling: Telegram holds the request open until a message arrives.
const POLL_TIMEOUT_S = 50;
const RETRY_MS = 5_000;
// Another process polling the same bot (dev next to the service) gets 409s.
const CONFLICT_RETRY_MS = 60_000;

// Survives dev hot reloads, so only one poll loop runs per process.
const state = ((globalThis as unknown as { __telegramBot?: { started: boolean } }).__telegramBot ??= {
  started: false,
});

/**
 * Called on server start. Uses long polling instead of a webhook, so the Mac
 * needs no public URL. Messages are handled one at a time, in order, while
 * polling continues.
 */
export function startBot() {
  if (state.started || !botToken()) return;
  state.started = true;
  // Before polling, so "back online" arrives before answers to missed messages.
  startPresence()
    .catch((err) => console.error("[telegram] presence failed to start", err))
    .finally(pollLoop);
}

// The "/" menu in Telegram; cheap to resend on every start.
const COMMANDS = [
  { command: "vandaag", description: "Afspraken en taken van vandaag" },
  { command: "week", description: "De komende 7 dagen" },
  { command: "doelen", description: "Je doelen en routines deze week" },
  { command: "project", description: "Voortgang GitLab-projecten (bv. /project kova)" },
  { command: "coach", description: "Coach aan/uit (bv. in de vakantie)" },
  { command: "t", description: "Snel een taak in TickTick (bv. /t morgen 9:00 mail docent)" },
  { command: "n", description: "Notitie opslaan" },
  { command: "uitleg", description: "Tech-uitleg (bv. /uitleg hoe werkt OAuth)" },
  { command: "fb", description: "Feedback over de bot of coach" },
  { command: "diep", description: "Lastige vraag (zwaarder model)" },
  { command: "nieuw", description: "Nieuw gesprek" },
  { command: "help", description: "Wat kan ik?" },
];

async function pollLoop() {
  await callTelegram("setMyCommands", { commands: COMMANDS }).catch((err) =>
    console.error("[telegram] setting the command menu failed", err)
  );
  await ensureKeyboard().catch((err) => console.error("[telegram] sending the keyboard failed", err));
  let offset = (await getSetting<number>(OFFSET_KEY).catch(() => undefined)) ?? 0;
  let queue = Promise.resolve();
  console.log("[telegram] bot started");

  for (;;) {
    try {
      const updates = await callTelegram<TelegramUpdate[]>("getUpdates", {
        offset,
        timeout: POLL_TIMEOUT_S,
        allowed_updates: ["message", "callback_query"],
      });
      for (const update of updates) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (msg) queue = queue.then(() => handleMessage(msg));
        const query = update.callback_query;
        // Same queue: a double tap is handled after the first one finished.
        if (query) queue = queue.then(() => handleCallback(query).catch((err) => console.error("[telegram] button failed", err)));
      }
      // Saved before handling finishes: a crash skips a message rather than repeating it.
      if (updates.length > 0) await setSetting(OFFSET_KEY, offset);
    } catch (err) {
      const conflict = err instanceof TelegramError && err.status === 409;
      console.error(
        conflict
          ? "[telegram] another process is polling this bot (is the service running next to dev?)"
          : "[telegram] polling failed",
        conflict ? "" : err
      );
      await new Promise((r) => setTimeout(r, conflict ? CONFLICT_RETRY_MS : RETRY_MS));
    }
  }
}
