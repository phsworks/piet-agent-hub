CREATE TABLE "portflow_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'file' NOT NULL,
	"created_on" date NOT NULL,
	"copy" integer DEFAULT 0 NOT NULL,
	"collections" text[] DEFAULT '{}'::text[] NOT NULL,
	"goals" text[] DEFAULT '{}'::text[] NOT NULL,
	"subgoals" text[] DEFAULT '{}'::text[] NOT NULL,
	"feedback_status" text,
	"roadmap_item_id" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gitlab_items" ADD COLUMN "start_on" date;--> statement-breakpoint
ALTER TABLE "portflow_evidence" ADD CONSTRAINT "portflow_evidence_roadmap_item_id_roadmap_items_id_fk" FOREIGN KEY ("roadmap_item_id") REFERENCES "public"."roadmap_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portflow_evidence_name_day_idx" ON "portflow_evidence" USING btree ("name","created_on","copy");