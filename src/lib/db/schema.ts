import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  vector,
  index,
  integer,
  jsonb,
  uniqueIndex,
  boolean,
  date,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Folder tree for files (School › Semester 3 › project, Work, ...). It started
// as a tree of chat agents; the prompt/tool columns are no longer used.
export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  parentId: uuid("parent_id").references((): AnyPgColumn => agents.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  branch: text("branch").notNull().default("general"),
  description: text("description").notNull().default(""),
  systemPrompt: text("system_prompt").notNull(),
  allowedTools: text("allowed_tools").array().notNull().default(sql`'{}'::text[]`),
  icon: text("icon").notNull().default("bot"),
  position: integer("position").notNull().default(0),
  // "project" agents get a dashboard with file sections and a generated overview.
  kind: text("kind", { enum: ["agent", "project"] }).notNull().default("agent"),
  overview: text("overview"),
  overviewUpdatedAt: timestamp("overview_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").references(() => agents.id, {
    onDelete: "set null",
  }),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  agentId: uuid("agent_id").references(() => agents.id, {
    onDelete: "set null",
  }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    content: text("content").notNull(),
    category: text("category").notNull().default("fact"),
    branch: text("branch").notNull().default("general"),
    source: text("source"),
    embedding: vector("embedding", { dimensions: 384 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("memories_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  ]
);

// Small key/value store for app-level settings (Google tokens, later iCal URLs).
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Cache of Drive folders the app created: one per agent, plus one per section
// for projects (section "" = the agent's own folder).
export const driveFolders = pgTable(
  "drive_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    section: text("section").notNull().default(""),
    driveFolderId: text("drive_folder_id").notNull(),
  },
  (table) => [uniqueIndex("drive_folders_agent_section_idx").on(table.agentId, table.section)]
);

// Existing Drive folders linked to an agent; their files are indexed in place.
export const driveLinks = pgTable(
  "drive_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    driveFolderId: text("drive_folder_id").notNull(),
    name: text("name").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("drive_links_agent_folder_idx").on(table.agentId, table.driveFolderId)]
);

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null until the Brain has classified a centrally dropped file.
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    section: text("section"),
    // upload = dropped in the app and copied to Drive; drive = indexed in place;
    // code = local code folder snapshot, only kept in the app.
    kind: text("kind", { enum: ["upload", "drive", "code"] }).notNull(),
    name: text("name").notNull(),
    // Relative path inside a dropped folder/zip, used as a classification hint.
    path: text("path"),
    mimeType: text("mime_type"),
    size: integer("size"),
    driveFileId: text("drive_file_id"),
    driveUrl: text("drive_url"),
    driveModifiedAt: timestamp("drive_modified_at", { withTimezone: true }),
    driveLinkId: uuid("drive_link_id").references(() => driveLinks.id, {
      onDelete: "cascade",
    }),
    status: text("status", { enum: ["queued", "processing", "ready", "failed"] })
      .notNull()
      .default("queued"),
    error: text("error"),
    summary: text("summary"),
    // Where the file came from: "web" (dropped in the app) or "telegram".
    source: text("source").notNull().default("web"),
    // Piet's own words with the upload (e.g. a Telegram caption); helps filing and search.
    note: text("note"),
    contentHash: text("content_hash"),
    // Raw bytes waiting for the worker; deleted once processed.
    tempPath: text("temp_path"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    index("files_agent_idx").on(table.agentId),
    index("files_status_idx").on(table.status),
    index("files_drive_file_idx").on(table.driveFileId),
  ]
);

export const fileChunks = pgTable(
  "file_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    // Source path within a code snapshot; null for regular documents.
    path: text("path"),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 384 }).notNull(),
  },
  (table) => [
    index("file_chunks_file_idx").on(table.fileId),
    index("file_chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  ]
);

// Calendar events from two kinds of source:
// - iCal feeds (feeds live in settings under "ical_feeds"), feedId = the feed's id
// - iCloud calendars over CalDAV, feedId = "icloud:<calendar url>"
// Each sync replaces a source's events within the sync window.
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feedId: text("feed_id").notNull(),
    // UID, plus the occurrence start for recurring events.
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    location: text("location"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    // Display name of the feed or iCloud calendar ("Sport", "Rooster").
    calendar: text("calendar"),
    // iCloud only: the .ics resource, needed to move or delete the event.
    href: text("href"),
    recurring: boolean("recurring").notNull().default(false),
  },
  (table) => [
    uniqueIndex("calendar_events_feed_external_idx").on(table.feedId, table.externalId),
    index("calendar_events_starts_idx").on(table.startsAt),
  ]
);

// The Brain's "today this matters" message, one per day (YYYY-MM-DD, local time).
export const dailyBriefings = pgTable("daily_briefings", {
  date: date("date", { mode: "string" }).primaryKey(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Coach: goals and fixed routines ("3× per week hardlopen, 's ochtends").
// With a duration they get planned in the calendar; without one Piet ticks
// them off in the evening check.
export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  timesPerWeek: integer("times_per_week").notNull(),
  durationMinutes: integer("duration_minutes"),
  // iCloud calendar planned sessions go in.
  calendar: text("calendar").notNull().default("Coach"),
  // morning | afternoon | evening | any
  preferred: text("preferred").notNull().default("any"),
  // Lowercase words; calendar events whose title contains one count as a session.
  match: text("match").array().notNull().default(sql`'{}'::text[]`),
  // Preferred weekdays (1 = Monday … 7 = Sunday); empty = any day.
  days: integer("days").array().notNull().default(sql`'{}'::integer[]`),
  // HH:mm: on those days a "time for …?" message at this time (instead of the evening check).
  remindAt: text("remind_at"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Every coach message with buttons (check-ins, suggestions). dedupKey makes
// sure a suggestion is sent at most once, also across restarts. Rows with a
// goalId + day + status done/skipped double as the log of routines ticked off.
export const coachPrompts = pgTable(
  "coach_prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // morning | evening | weekly | goal | deadline | check
    kind: text("kind").notNull(),
    dedupKey: text("dedup_key").notNull(),
    payload: jsonb("payload").notNull().default({}),
    messageId: integer("message_id"),
    // sent | planned | skipped | done
    status: text("status").notNull().default("sent"),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("coach_prompts_dedup_idx").on(table.dedupKey),
    index("coach_prompts_goal_day_idx").on(table.goalId, table.day),
  ]
);

// Things about the hub itself that bother Piet ("de coach stuurt te vaak…"),
// sent from Telegram. Settings the assistant can change are applied at once
// (resolution says how); the rest waits for the next coding session
// (`npm run feedback` lists them).
export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  text: text("text").notNull(),
  // open | applied | done | dismissed
  status: text("status").notNull().default("open"),
  resolution: text("resolution"),
  source: text("source").notNull().default("telegram"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// GitLab projects the hub follows (HvA GitLab: Kova, school projects). Picked
// in Settings; kind "school" vs "project" only changes how they're grouped.
export const gitlabProjects = pgTable("gitlab_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  gitlabId: integer("gitlab_id").notNull().unique(),
  // "group/kova"
  path: text("path").notNull(),
  name: text("name").notNull(),
  webUrl: text("web_url").notNull(),
  // project | school
  kind: text("kind").notNull().default("project"),
  // The matching folder in the tree, so the focus suggestion and progress use one name.
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Commits, merge requests, issues and milestones of followed projects, synced
// incrementally (updated_after). Progress and deadlines are computed from here
// in code, so asking "hoe staat Kova ervoor?" needs no GitLab request.
export const gitlabItems = pgTable(
  "gitlab_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => gitlabProjects.id, { onDelete: "cascade" }),
    // commit | mr | issue | milestone
    type: text("type").notNull(),
    // Commit sha, or the iid/id GitLab shows.
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    // opened | closed | merged | active (milestones) | null for commits
    state: text("state"),
    author: text("author"),
    // Authored by or assigned to Piet.
    mine: boolean("mine").notNull().default(false),
    url: text("url"),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    milestone: text("milestone"),
    // Commit date, or when the MR/issue/milestone was created.
    happenedAt: timestamp("happened_at", { withTimezone: true }).notNull(),
    // Merged or closed.
    closedAt: timestamp("closed_at", { withTimezone: true }),
    dueOn: date("due_on", { mode: "string" }),
    // Milestones only: the first day (sprints are milestones "Sprint 1", ...).
    startOn: date("start_on", { mode: "string" }),
  },
  (table) => [
    uniqueIndex("gitlab_items_project_type_external_idx").on(table.projectId, table.type, table.externalId),
    index("gitlab_items_happened_idx").on(table.happenedAt),
  ]
);

export type RoadmapLinks = { products?: string[]; outcomes?: string[]; knowledge?: string[] };

// The school roadmap (HvA roadmap site, roadmap.json), synced daily. Piet's
// own progress lives in the same row (status, evidence); the sync never
// touches those columns. Status is tracked for side quests and products, the
// things that go into Portflow as evidence; the rest is context.
export const roadmapItems = pgTable(
  "roadmap_items",
  {
    // The roadmap's own id, e.g. "p-ci-cd-8g6p".
    id: text("id").primaryKey(),
    // outcome | assignment | side | product | knowledge
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    // Outcome code, e.g. "AA2-2".
    code: text("code"),
    // Canvas group: De Teamspeler, De Techneut, ...
    theme: text("theme"),
    // For outcomes: their criteria, one per line.
    description: text("description").notNull().default(""),
    links: jsonb("links").$type<RoadmapLinks>().notNull().default({}),
    position: integer("position").notNull().default(0),
    // todo | bezig | klaar | in_portflow
    status: text("status").notNull().default("todo"),
    // manual | gitlab (GitLab only ever moves todo → bezig)
    statusSource: text("status_source"),
    statusAt: timestamp("status_at", { withTimezone: true }),
    evidenceUrl: text("evidence_url"),
    note: text("note"),
    // Extra words that link GitLab commits/issues/MRs to this item.
    match: text("match").array().notNull().default(sql`'{}'::text[]`),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("roadmap_items_kind_idx").on(table.kind)]
);

// Piet's evidence in Portflow ("Mijn bewijs"), read from screenshots he sends
// in Telegram (Portflow has no student API). Every screenshot adds to it, so a
// partial one never removes anything. Collections are the roadmap themes
// (De Techneut, ...), goals the learning outcomes as codes (OR, PL, AA, MS).
export const portflowEvidence = pgTable(
  "portflow_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // file | link | feedback | other (the icon in the Type column)
    type: text("type").notNull().default("file"),
    createdOn: date("created_on", { mode: "string" }).notNull(),
    // 0, 1, …: the same name twice on one day (e.g. one file linked to two collections).
    copy: integer("copy").notNull().default(0),
    collections: text("collections").array().notNull().default(sql`'{}'::text[]`),
    // Outcome codes without the semester number: OR, PL, AA, MS.
    goals: text("goals").array().notNull().default(sql`'{}'::text[]`),
    subgoals: text("subgoals").array().notNull().default(sql`'{}'::text[]`),
    feedbackStatus: text("feedback_status"),
    // The side quest or product it is evidence for, when the name says so.
    roadmapItemId: text("roadmap_item_id").references(() => roadmapItems.id, { onDelete: "set null" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("portflow_evidence_name_day_idx").on(table.name, table.createdOn, table.copy)]
);

// Documents the assistant wrote on request (create_document, /maak). They live
// as Google Docs in /PietBrain/Gemaakt/<folder>; this row keeps the link and
// the roadmap item they're for, so Piet (and the Portflow check) can find them.
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  // School | Werk | Overig: the subfolder under /PietBrain/Gemaakt.
  folder: text("folder").notNull(),
  request: text("request").notNull(),
  driveFileId: text("drive_file_id").notNull(),
  driveUrl: text("drive_url"),
  roadmapItemId: text("roadmap_item_id").references(() => roadmapItems.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vectorExtension = sql`CREATE EXTENSION IF NOT EXISTS vector`;
