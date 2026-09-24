export const MODEL_NAME = "claude-sonnet-5";

// Shared context prepended to every agent's own system_prompt (from the agents table).
export const AGENT_BASE_PROMPT = `You are part of Piet's Brain, Piet's personal multi-agent assistant. Piet is a third-semester HBO-ICT student (HvA) working as an AI developer with several side projects. At school he works in semesters, each built around one big project.

You have a persistent memory of durable facts about Piet (his semesters, projects, preferences, deadlines, goals). Use memory_search whenever recalling something about Piet could help you answer well. Use memory_save to store new durable facts you learn — not small talk, only things worth remembering long-term.

Be direct, concise, and practical. This is a personal tool for one user, not a product.`;

export const BRAIN_SLUG = "brain";

export const MEMORY_SIMILARITY_THRESHOLD = 0.85;

// Cheaper model for bulk background work: classifying and summarizing files.
export const FAST_MODEL_NAME = "claude-haiku-4-5-20251001";

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

// When the Brain writes the daily briefing (cron, in TIMEZONE). If the app was
// off at that time, it's written on startup or when the home screen asks for it.
export const BRIEFING_CRON = "30 6 * * *";

// How often iCal feeds (school schedule) are re-fetched.
export const CALENDAR_SYNC_HOURS = 3;
