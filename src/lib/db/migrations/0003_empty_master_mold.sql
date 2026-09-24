CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_id" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_briefings" (
	"date" date PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"due_date" date,
	"agent_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"proposed_by" text,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_feed_external_idx" ON "calendar_events" USING btree ("feed_id","external_id");--> statement-breakpoint
CREATE INDEX "calendar_events_starts_idx" ON "calendar_events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "reminders_status_idx" ON "reminders" USING btree ("status");