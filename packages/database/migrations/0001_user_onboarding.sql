ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT true NOT NULL;
UPDATE "users" SET "must_change_password" = false;
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_normalized_unique" ON "users" (lower("email"));
