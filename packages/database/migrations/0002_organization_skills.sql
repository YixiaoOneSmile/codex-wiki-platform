CREATE TABLE "skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "instructions" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "skills_org_slug_unique" ON "skills" ("org_id", "slug");
CREATE INDEX "skills_org_enabled_idx" ON "skills" ("org_id", "enabled");
