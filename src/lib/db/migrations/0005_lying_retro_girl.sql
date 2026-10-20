DROP TABLE "reminders" CASCADE;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "calendar" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "href" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "recurring" boolean DEFAULT false NOT NULL;