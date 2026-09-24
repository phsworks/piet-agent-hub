CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"branch" text DEFAULT 'general' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"system_prompt" text NOT NULL,
	"allowed_tools" text[] DEFAULT '{}'::text[] NOT NULL,
	"icon" text DEFAULT 'bot' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_parent_id_agents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;