CREATE TABLE "roadmap_items" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"code" text,
	"theme" text,
	"description" text DEFAULT '' NOT NULL,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"status_source" text,
	"status_at" timestamp with time zone,
	"evidence_url" text,
	"note" text,
	"match" text[] DEFAULT '{}'::text[] NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "roadmap_items_kind_idx" ON "roadmap_items" USING btree ("kind");