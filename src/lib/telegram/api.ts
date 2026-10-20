// Thin wrapper around the Telegram Bot API (https://core.telegram.org/bots/api).
// Plain fetch, no bot framework.

// Telegram rejects longer messages.
const MAX_MESSAGE_CHARS = 4000;
// Bots can only download files up to this size.
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export type TelegramUser = { id: number; first_name: string; username?: string };
export type TelegramPhotoSize = { file_id: string; file_size?: number; width: number; height: number };
export type TelegramDocument = { file_id: string; file_name?: string; mime_type?: string; file_size?: number };

export type TelegramMessage = {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  voice?: unknown;
  video?: unknown;
  audio?: unknown;
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: { message_id: number; chat: { id: number }; text?: string };
  data?: string;
};

export type TelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery };

/** Buttons under one message; `data` comes back in a callback query (max 64 bytes). */
export type InlineButton = { text: string; data: string };

function inlineMarkup(rows: InlineButton[][]) {
  return { inline_keyboard: rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) };
}

export function botToken() {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

/** Piet's chat id; the bot ignores everyone else. */
export function ownerChatId() {
  const raw = process.env.TELEGRAM_CHAT_ID?.trim();
  return raw ? Number(raw) : null;
}

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function callTelegram<T>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const token = botToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  const body = (await res.json().catch(() => null)) as { ok: boolean; result?: T; description?: string } | null;
  if (!body?.ok) throw new TelegramError(`${method}: ${body?.description ?? res.statusText}`, res.status);
  return body.result as T;
}

/** Sends text, split over several messages if it's too long. Links get no preview cards. */
/** `replyMarkup` (a keyboard) goes with the last part of a long message. */
export async function sendMessage(chatId: number, text: string, replyMarkup?: object) {
  const parts = splitMessage(text);
  for (const [i, part] of parts.entries()) {
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: part,
      link_preview_options: { is_disabled: true },
      ...(replyMarkup && i === parts.length - 1 ? { reply_markup: replyMarkup } : {}),
    });
  }
}

/** Sends a message to Piet, if the bot is set up. Never throws. */
export async function notifyOwner(text: string, replyMarkup?: object) {
  const chatId = ownerChatId();
  if (!botToken() || !chatId) return;
  await sendMessage(chatId, text, replyMarkup).catch((err) => console.error("Telegram notify failed", err));
}

/** Sends one message with buttons to Piet and returns its id (null if the bot isn't set up). */
export async function sendButtons(text: string, rows: InlineButton[][]) {
  const chatId = ownerChatId();
  if (!botToken() || !chatId) return null;
  const message = await callTelegram<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, MAX_MESSAGE_CHARS),
    link_preview_options: { is_disabled: true },
    ...(rows.length ? { reply_markup: inlineMarkup(rows) } : {}),
  });
  return message.message_id;
}

/** Replaces a message's text and buttons (no rows = buttons removed). */
export async function editButtons(chatId: number, messageId: number, text: string, rows: InlineButton[][] = []) {
  await callTelegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, MAX_MESSAGE_CHARS),
    link_preview_options: { is_disabled: true },
    reply_markup: inlineMarkup(rows),
  }).catch((err) => {
    // Pressing the same button twice makes an identical edit; Telegram rejects that.
    if (!String(err).includes("message is not modified")) throw err;
  });
}

/** Stops the loading spinner on a pressed button, optionally with a short toast. */
export async function answerCallback(id: string, text?: string) {
  await callTelegram("answerCallbackQuery", { callback_query_id: id, ...(text && { text }) }).catch(() => {});
}

export async function sendTyping(chatId: number) {
  await callTelegram("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const file = await callTelegram<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("Telegram gave no download path for this file.");
  const res = await fetch(`https://api.telegram.org/file/bot${botToken()}/${file.file_path}`);
  if (!res.ok) throw new Error(`Download failed: ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

function splitMessage(text: string) {
  const parts: string[] = [];
  let rest = text.trim() || "…";
  while (rest.length > MAX_MESSAGE_CHARS) {
    // Prefer to cut at a paragraph or line break.
    let cut = rest.lastIndexOf("\n\n", MAX_MESSAGE_CHARS);
    if (cut < MAX_MESSAGE_CHARS / 2) cut = rest.lastIndexOf("\n", MAX_MESSAGE_CHARS);
    if (cut < MAX_MESSAGE_CHARS / 2) cut = MAX_MESSAGE_CHARS;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  parts.push(rest);
  return parts;
}
