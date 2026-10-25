CREATE TABLE "gitlab_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"state" text,
	"author" text,
	"mine" boolean DEFAULT false NOT NULL,
	"url" text,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"milestone" text,
	"happened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"due_on" date
);
--> statement-breakpoint
CREATE TABLE "gitlab_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gitlab_id" integer NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"web_url" text NOT NULL,
	"kind" text DEFAULT 'project' NOT NULL,
	"agent_id" uuid,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gitlab_projects_gitlab_id_unique" UNIQUE("gitlab_id")
);
--> statement-breakpoint
ALTER TABLE "gitlab_items" ADD CONSTRAINT "gitlab_items_project_id_gitlab_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."gitlab_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_projects" ADD CONSTRAINT "gitlab_projects_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gitlab_items_project_type_external_idx" ON "gitlab_items" USING btree ("project_id","type","external_id");--> statement-breakpoint
CREATE INDEX "gitlab_items_happened_idx" ON "gitlab_items" USING btree ("happened_at");