// The assistant answers on Haiku by default; "/diep" (Telegram) or the Deep
// toggle (web) switches one message to Sonnet.
export const ASSISTANT_MODEL = "claude-haiku-5-5";
export const DEEP_MODEL = "claude-sonnet-5-5";

export const BRAIN_SLUG = "brain";

export const MEMORY_SIMILARITY_THRESHOLD = 0.85;

// Cheaper model for bulk background work: classifying and summarizing files.
export const FAST_MODEL_NAME = "claude-haiku-5-5";

// Language for generated content Piet reads (summaries, overviews).
export const CONTENT_LANGUAGE = "Dutch";

// Sections every project dashboard is split into. Code is separate (see files.kind).
export const PROJECT_SECTIONS = [
  { key: "brief", label: "Brief & requirements", hint: "assignment descriptions, requirements, rubrics, study guides, planning" },
  { key: "deliverables", label: "Deliverables", hint: "Piet's own work: reports, designs, presentations, submissions" },
  { key: "feedback", label: "Feedback", hint: "feedback from teachers, peers or clients, assessment results" },
  { key: "notes", label: "Notes & research", hint: "notes, meeting notes, research, reading material, sources" },
  { key: "other", label: "Other", hint: "anything that doesn't fit the other sections" },
] as const;

export type ProjectSection = (typeof PROJECT_SECTIONS)[number]["key"];

// Name of the root folder the app creates in Piet's Drive.
export const DRIVE_ROOT_FOLDER = "PietBrain";

// Piet's timezone: decides what "today" is for reminders, the calendar and the daily briefing.
export const TIMEZONE = "Europe/Amsterdam";

// How often iCal feeds (school schedule) are re-fetched.
export const CALENDAR_SYNC_HOURS = 3;

// How many earlier messages of a conversation the assistant sees. Short on
// purpose: every message is resent with each question.
export const ASSISTANT_HISTORY_MESSAGES = 8;

// iCloud calendar the assistant plans things in (created on first use); sport goes to SPORT_CALENDAR.
export const COACH_CALENDAR = "Coach";
export const SPORT_CALENDAR = "Sport";
// How often iCloud calendars are checked for changes (cheap: unchanged calendars are skipped).
export const ICLOUD_SYNC_MINUTES = 15;

// Coach (local times). Check-ins are sent once per day; if the Mac was asleep
// at the time, they still go out as long as the window hasn't closed.
export const COACH = {
  morning: { from: "07:30", until: "11:00" },
  evening: { from: "21:00", until: "23:00" },
  // Sunday.
  weekly: { from: "19:00", until: "22:00" },
  // No suggestions outside these hours, and at most this many per day.
  nudgeHours: { from: "08:00", until: "21:30" },
  maxNudgesPerDay: 2,
  // A TickTick task due within this many days without a work block gets one suggested.
  deadlineDays: 3,
  // Lists whose tasks are small errands: no work block suggestions.
  noBlockLists: ["Dagelijkse reminders"],
  // Margin around existing events when looking for free time.
  bufferMinutes: 15,
} as const;

// When a goal "prefers" a part of the day, slots are searched in these windows.
export const DAY_PARTS = {
  morning: { from: "07:00", until: "11:00" },
  afternoon: { from: "12:00", until: "17:30" },
  evening: { from: "18:00", until: "22:00" },
  any: { from: "08:00", until: "21:30" },
} as const;
