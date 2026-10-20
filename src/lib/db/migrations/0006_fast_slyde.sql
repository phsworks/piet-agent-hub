CREATE TABLE "coach_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"dedup_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"message_id" integer,
	"status" text DEFAULT 'sent' NOT NULL,
	"goal_id" uuid,
	"day" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"times_per_week" integer NOT NULL,
	"duration_minutes" integer,
	"calendar" text DEFAULT 'Coach' NOT NULL,
	"preferred" text DEFAULT 'any' NOT NULL,
	"match" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coach_prompts" ADD CONSTRAINT "coach_prompts_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coach_prompts_dedup_idx" ON "coach_prompts" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "coach_prompts_goal_day_idx" ON "coach_prompts" USING btree ("goal_id","day");