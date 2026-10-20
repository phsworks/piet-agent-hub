ALTER TABLE "goals" ADD COLUMN "days" integer[] DEFAULT '{}'::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "remind_at" text;