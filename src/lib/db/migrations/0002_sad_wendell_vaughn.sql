CREATE TABLE "drive_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"section" text DEFAULT '' NOT NULL,
	"drive_folder_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"drive_folder_id" text NOT NULL,
	"name" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"path" text,
	"content" text NOT NULL,
	"embedding" vector(384) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid,
	"section" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"path" text,
	"mime_type" text,
	"size" integer,
	"drive_file_id" text,
	"drive_url" text,
	"drive_modified_at" timestamp with time zone,
	"drive_link_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"summary" text,
	"content_hash" text,
	"temp_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "kind" text DEFAULT 'agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "overview" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "overview_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drive_folders" ADD CONSTRAINT "drive_folders_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_links" ADD CONSTRAINT "drive_links_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_drive_link_id_drive_links_id_fk" FOREIGN KEY ("drive_link_id") REFERENCES "public"."drive_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_folders_agent_section_idx" ON "drive_folders" USING btree ("agent_id","section");--> statement-breakpoint
CREATE UNIQUE INDEX "drive_links_agent_folder_idx" ON "drive_links" USING btree ("agent_id","drive_folder_id");--> statement-breakpoint
CREATE INDEX "file_chunks_file_idx" ON "file_chunks" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "file_chunks_embedding_idx" ON "file_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "files_agent_idx" ON "files" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "files_status_idx" ON "files" USING btree ("status");--> statement-breakpoint
CREATE INDEX "files_drive_file_idx" ON "files" USING btree ("drive_file_id");