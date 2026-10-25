import { getSetting, setSetting } from "@/lib/settings";
import { notifyOwner } from "./api";

// Fixed buttons under the chat. A button press arrives as a plain text
// message with the label, so handlers match on these exact strings.
export const BUTTONS = {
  today: "📅 Vandaag",
  week: "🗓 Week",
  task: "➕ Taak",
  note: "📝 Notitie",
  goals: "🎯 Doelen",
  feedback: "🛠 Feedback",
} as const;

export const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: BUTTONS.today }, { text: BUTTONS.week }, { text: BUTTONS.goals }],
    [{ text: BUTTONS.task }, { text: BUTTONS.note }, { text: BUTTONS.feedback }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "Vraag of zeg iets…",
};

const VERSION_KEY = "telegram_keyboard_version";
// Bump when the buttons change, so Piet gets the new keyboard once.
const KEYBOARD_VERSION = 3;

/** Sends the keyboard once per version; Telegram keeps showing it after that. */
export async function ensureKeyboard() {
  if ((await getSetting<number>(VERSION_KEY)) === KEYBOARD_VERSION) return;
  await notifyOwner("Nieuwe knop: 🛠 Feedback. Stoort iets aan mij of de coach? Zeg het daar; wat ik zelf kan aanpassen doe ik meteen, de rest komt op de lijst voor de volgende codesessie. Tech-vragen kun je me ook gewoon stellen (of /uitleg <onderwerp>).", MAIN_KEYBOARD);
  await setSetting(VERSION_KEY, KEYBOARD_VERSION);
}
