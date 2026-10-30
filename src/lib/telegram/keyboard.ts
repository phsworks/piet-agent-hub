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
  school: "🎓 School",
  portflow: "📎 Portflow",
  feedback: "🛠 Feedback",
} as const;

export const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: BUTTONS.today }, { text: BUTTONS.week }, { text: BUTTONS.goals }, { text: BUTTONS.school }],
    [{ text: BUTTONS.portflow }, { text: BUTTONS.task }, { text: BUTTONS.note }, { text: BUTTONS.feedback }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "Vraag of zeg iets…",
};

const VERSION_KEY = "telegram_keyboard_version";
// Bump when the buttons change, so Piet gets the new keyboard once.
const KEYBOARD_VERSION = 5;

/** Sends the keyboard once per version; Telegram keeps showing it after that. */
export async function ensureKeyboard() {
  if ((await getSetting<number>(VERSION_KEY)) === KEYBOARD_VERSION) return;
  await notifyOwner("Nieuwe knop: 📎 Portflow. Een lijst van wat er nu in je Portflow mist, op basis van de datum, je sprint, je agenda, je roadmap en wat je in GitLab hebt gedaan. Nieuwe screenshots sturen kan met de knop onder de lijst.", MAIN_KEYBOARD);
  await setSetting(VERSION_KEY, KEYBOARD_VERSION);
}
