import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const orgRoleEnum = pgEnum("org_role", ["owner", "admin", "member"]);
export const wikiRoleEnum = pgEnum("wiki_role", ["editor", "user"]);
export const wikiScopeEnum = pgEnum("wiki_scope", ["team", "personal"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system", "tool"]);
export const runStatusEnum = pgEnum("run_status", ["queued", "running", "awaiting_approval", "completed", "failed", "cancelled"]);
export const auditOutcomeEnum = pgEnum("audit_outcome", ["success", "denied", "failure"]);
export const scheduledTaskStatusEnum = pgEnum("scheduled_task_status", ["scheduled", "running", "paused", "completed", "failed", "cancelled"]);
export const scheduledTaskSourceEnum = pgEnum("scheduled_task_source", ["manual", "conversation"]);
export const scheduledTaskRecurrenceEnum = pgEnum("scheduled_task_recurrence", ["once", "daily", "weekly", "monthly", "interval"]);
export const scheduledTaskRunStatusEnum = pgEnum("scheduled_task_run_status", ["running", "completed", "failed"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [uniqueIndex("users_email_lower_unique").on(t.email)]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  logoUrl: text("logo_url"),
  accentColor: text("accent_color").notNull().default("#10a37f"),
  personalWikiEnabled: boolean("personal_wiki_enabled").notNull().default(false),
  ...timestamps,
});

export const memberships = pgTable("memberships", {
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: orgRoleEnum("role").notNull().default("member"),
  teamWikiRole: wikiRoleEnum("team_wiki_role").notNull().default("user"),
  ...timestamps,
}, (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("memberships_user_idx").on(t.userId)]);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  activeOrgId: uuid("active_org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  userAgent: text("user_agent"),
  ipHash: text("ip_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wikiSpaces = pgTable("wiki_spaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  scope: wikiScopeEnum("scope").notNull(),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ...timestamps,
}, (t) => [
  uniqueIndex("wiki_spaces_team_unique").on(t.orgId).where(sql`${t.scope} = 'team'`),
  uniqueIndex("wiki_spaces_personal_unique").on(t.orgId, t.ownerUserId).where(sql`${t.scope} = 'personal'`),
  index("wiki_spaces_org_idx").on(t.orgId),
]);

export const wikiPages = pgTable("wiki_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id").notNull().references(() => wikiSpaces.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  path: text("path").notNull(),
  title: text("title").notNull(),
  markdown: text("markdown").notNull().default(""),
  version: integer("version").notNull().default(1),
  sourceType: text("source_type").notNull().default("manual"),
  sourceName: text("source_name"),
  sourceChecksum: text("source_checksum"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  updatedBy: uuid("updated_by").notNull().references(() => users.id),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  uniqueIndex("wiki_pages_space_path_unique").on(t.spaceId, t.path),
  index("wiki_pages_org_space_idx").on(t.orgId, t.spaceId),
]);

export const wikiPageVersions = pgTable("wiki_page_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  pageId: uuid("page_id").notNull().references(() => wikiPages.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  markdown: text("markdown").notNull(),
  changedBy: uuid("changed_by").notNull().references(() => users.id),
  changeSummary: text("change_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("wiki_page_versions_unique").on(t.pageId, t.version), index("wiki_page_versions_org_idx").on(t.orgId)]);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("新对话"),
  codexThreadId: text("codex_thread_id"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [index("conversations_owner_idx").on(t.orgId, t.ownerUserId)]);

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  runId: uuid("run_id"),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("messages_conversation_idx").on(t.orgId, t.conversationId, t.createdAt)]);

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  codexTurnId: text("codex_turn_id"),
  status: runStatusEnum("status").notNull().default("queued"),
  correlationId: uuid("correlation_id").notNull(),
  errorCode: text("error_code"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("agent_runs_conversation_idx").on(t.orgId, t.conversationId),
  uniqueIndex("agent_runs_one_active_conversation").on(t.conversationId).where(sql`${t.status} in ('queued', 'running', 'awaiting_approval')`),
]);

export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  providerRequestId: text("provider_request_id"),
  model: text("model").notNull(),
  inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
  cachedInputTokens: bigint("cached_input_tokens", { mode: "number" }).notNull().default(0),
  outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  estimatedCost: numeric("estimated_cost", { precision: 18, scale: 8 }).notNull().default("0"),
  latencyMs: integer("latency_ms"),
  success: boolean("success").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("usage_org_created_idx").on(t.orgId, t.createdAt), index("usage_user_created_idx").on(t.userId, t.createdAt)]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  correlationId: uuid("correlation_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  outcome: auditOutcomeEnum("outcome").notNull(),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_org_created_idx").on(t.orgId, t.createdAt), index("audit_correlation_idx").on(t.correlationId)]);

export const behaviorEvents = pgTable("behavior_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  route: text("route"),
  properties: jsonb("properties").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("behavior_org_created_idx").on(t.orgId, t.createdAt)]);

export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull().unique(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  checksum: text("checksum").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("uploads_org_idx").on(t.orgId, t.createdAt)]);

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  instructions: text("instructions").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  updatedBy: uuid("updated_by").notNull().references(() => users.id),
  ...timestamps,
}, (t) => [uniqueIndex("skills_org_slug_unique").on(t.orgId, t.slug), index("skills_org_enabled_idx").on(t.orgId, t.enabled)]);

export const scheduledTasks = pgTable("scheduled_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  instruction: text("instruction").notNull().default("抓取网页并保存为 Markdown"),
  url: text("url").notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  recurrenceType: scheduledTaskRecurrenceEnum("recurrence_type").notNull().default("once"),
  recurrenceConfig: jsonb("recurrence_config").notNull().default({}),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  status: scheduledTaskStatusEnum("status").notNull().default("scheduled"),
  source: scheduledTaskSourceEnum("source").notNull().default("manual"),
  resultMarkdown: text("result_markdown"),
  resultMetadata: jsonb("result_metadata").notNull().default({}),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  runCount: integer("run_count").notNull().default(0),
  ...timestamps,
}, (t) => [
  index("scheduled_tasks_due_idx").on(t.status, t.scheduledFor),
  index("scheduled_tasks_owner_idx").on(t.orgId, t.userId, t.createdAt),
]);

export const scheduledTaskRuns = pgTable("scheduled_task_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => scheduledTasks.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  status: scheduledTaskRunStatusEnum("status").notNull().default("running"),
  resultMarkdown: text("result_markdown"),
  resultMetadata: jsonb("result_metadata").notNull().default({}),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  index("scheduled_task_runs_task_idx").on(t.taskId, t.startedAt),
  index("scheduled_task_runs_owner_idx").on(t.orgId, t.userId, t.startedAt),
]);
