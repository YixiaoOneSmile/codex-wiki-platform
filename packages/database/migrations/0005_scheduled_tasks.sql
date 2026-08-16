CREATE TYPE "public"."scheduled_task_status" AS ENUM('scheduled', 'running', 'completed', 'failed', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."scheduled_task_source" AS ENUM('manual', 'conversation');
--> statement-breakpoint
CREATE TABLE "scheduled_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"title" text NOT NULL,
	"instruction" text DEFAULT '抓取网页并保存为 Markdown' NOT NULL,
	"url" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" "scheduled_task_status" DEFAULT 'scheduled' NOT NULL,
	"source" "scheduled_task_source" DEFAULT 'manual' NOT NULL,
	"result_markdown" text,
	"result_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "scheduled_tasks_due_idx" ON "scheduled_tasks" USING btree ("status","scheduled_for");
--> statement-breakpoint
CREATE INDEX "scheduled_tasks_owner_idx" ON "scheduled_tasks" USING btree ("org_id","user_id","created_at");
