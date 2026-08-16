ALTER TYPE "public"."scheduled_task_status" ADD VALUE IF NOT EXISTS 'paused' BEFORE 'completed';
CREATE TYPE "public"."scheduled_task_recurrence" AS ENUM('once', 'daily', 'weekly', 'monthly', 'interval');
CREATE TYPE "public"."scheduled_task_run_status" AS ENUM('running', 'completed', 'failed');

ALTER TABLE "scheduled_tasks" ADD COLUMN "recurrence_type" "scheduled_task_recurrence" DEFAULT 'once' NOT NULL;
ALTER TABLE "scheduled_tasks" ADD COLUMN "recurrence_config" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "scheduled_tasks" ADD COLUMN "timezone" text DEFAULT 'Asia/Shanghai' NOT NULL;
ALTER TABLE "scheduled_tasks" ADD COLUMN "last_run_at" timestamp with time zone;
ALTER TABLE "scheduled_tasks" ADD COLUMN "paused_at" timestamp with time zone;
ALTER TABLE "scheduled_tasks" ADD COLUMN "ended_at" timestamp with time zone;
ALTER TABLE "scheduled_tasks" ADD COLUMN "run_count" integer DEFAULT 0 NOT NULL;

CREATE TABLE "scheduled_task_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "scheduled_for" timestamp with time zone NOT NULL,
  "status" "scheduled_task_run_status" DEFAULT 'running' NOT NULL,
  "result_markdown" text,
  "result_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_message" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "scheduled_task_runs" ADD CONSTRAINT "scheduled_task_runs_task_id_scheduled_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."scheduled_tasks"("id") ON DELETE cascade;
ALTER TABLE "scheduled_task_runs" ADD CONSTRAINT "scheduled_task_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
ALTER TABLE "scheduled_task_runs" ADD CONSTRAINT "scheduled_task_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
CREATE INDEX "scheduled_task_runs_task_idx" ON "scheduled_task_runs" USING btree ("task_id", "started_at");
CREATE INDEX "scheduled_task_runs_owner_idx" ON "scheduled_task_runs" USING btree ("org_id", "user_id", "started_at");
