ALTER TABLE "files" ADD COLUMN "source" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "note" text;