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

// Quick reminders Piet types in himself, or that an agent proposed (status
// "proposed" until Piet accepts). With a due date they show up as deadlines.
export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    notes: text("notes"),
    dueDate: date("due_date", { mode: "string" }),
    // The node this reminder belongs to.
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    status: text("status", { enum: ["proposed", "open", "done"] }).notNull().default("open"),
    // Name of the agent that proposed it; null when Piet added it himself.
    proposedBy: text("proposed_by"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("reminders_status_idx").on(table.status)]
);

// Events from iCal feeds (feeds themselves live in settings under "ical_feeds").
// Each sync replaces a feed's events within the sync window.
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

export const vectorExtension = sql`CREATE EXTENSION IF NOT EXISTS vector`;
