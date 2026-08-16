import { scheduledTaskRuns, scheduledTasks, usageEvents } from "@cwp/database";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError, notFound } from "../lib/errors.js";
import { tenantOf } from "../lib/tenant.js";
import { assertSafeCrawlUrl } from "../services/crawl4ai.js";
import { writeAudit } from "../services/audit.js";
import { interpretNaturalTask, type NaturalTaskUsage } from "../services/task-natural-language.js";
import { nextOccurrence, recurrenceTypeSchema, validateRecurrence, type RecurrenceConfig } from "../services/task-recurrence.js";

const taskBody = z.object({
  title: z.string().trim().min(1).max(120),
  instruction: z.string().trim().min(1).max(2_000).default("抓取网页并保存为 Markdown"),
  url: z.string().trim().max(2_000),
  scheduledFor: z.coerce.date(),
  recurrenceType: recurrenceTypeSchema.default("once"),
  recurrenceConfig: z.unknown().default({}),
  timezone: z.string().trim().min(1).max(80).default("Asia/Shanghai"),
});

function assertFuture(date: Date) {
  if (date.getTime() <= Date.now() + 5_000) throw new AppError(400, "INVALID_SCHEDULE_TIME", "执行时间必须晚于当前时间");
  if (date.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) throw new AppError(400, "INVALID_SCHEDULE_TIME", "暂时只能创建未来一年内的任务");
}

async function recordParserUsage(app: Parameters<FastifyPluginAsync>[0], tenant: ReturnType<typeof tenantOf>, usage: NaturalTaskUsage) {
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const cost = (uncached * app.config.DEEPSEEK_INPUT_PRICE_PER_MILLION + usage.cachedInputTokens * app.config.DEEPSEEK_CACHED_INPUT_PRICE_PER_MILLION + usage.outputTokens * app.config.DEEPSEEK_OUTPUT_PRICE_PER_MILLION) / 1_000_000;
  await app.db.insert(usageEvents).values({ orgId: tenant.orgId, userId: tenant.userId, providerRequestId: usage.requestId, model: app.config.DEEPSEEK_MODEL, inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens, estimatedCost: cost.toFixed(8), latencyMs: usage.latencyMs, success: true });
}

const taskSelection = {
  id: scheduledTasks.id, title: scheduledTasks.title, instruction: scheduledTasks.instruction, url: scheduledTasks.url,
  scheduledFor: scheduledTasks.scheduledFor, status: scheduledTasks.status, source: scheduledTasks.source,
  recurrenceType: scheduledTasks.recurrenceType, recurrenceConfig: scheduledTasks.recurrenceConfig, timezone: scheduledTasks.timezone,
  resultMetadata: scheduledTasks.resultMetadata, errorMessage: scheduledTasks.errorMessage,
  startedAt: scheduledTasks.startedAt, finishedAt: scheduledTasks.finishedAt, lastRunAt: scheduledTasks.lastRunAt,
  pausedAt: scheduledTasks.pausedAt, endedAt: scheduledTasks.endedAt, runCount: scheduledTasks.runCount,
  createdAt: scheduledTasks.createdAt, updatedAt: scheduledTasks.updatedAt,
};

const scheduledTaskRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request) => {
    const tenant = tenantOf(request);
    const tasks = await app.db.select(taskSelection).from(scheduledTasks)
      .where(and(eq(scheduledTasks.orgId, tenant.orgId), eq(scheduledTasks.userId, tenant.userId)))
      .orderBy(desc(scheduledTasks.createdAt)).limit(200);
    return { tasks };
  });

  app.get("/:taskId", async (request) => {
    const tenant = tenantOf(request);
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const task = await app.db.query.scheduledTasks.findFirst({ where: and(eq(scheduledTasks.id, taskId), eq(scheduledTasks.orgId, tenant.orgId), eq(scheduledTasks.userId, tenant.userId)) });
    if (!task) throw notFound();
    const runs = await app.db.select({ id: scheduledTaskRuns.id, scheduledFor: scheduledTaskRuns.scheduledFor, status: scheduledTaskRuns.status, errorMessage: scheduledTaskRuns.errorMessage, startedAt: scheduledTaskRuns.startedAt, finishedAt: scheduledTaskRuns.finishedAt })
      .from(scheduledTaskRuns).where(and(eq(scheduledTaskRuns.taskId, taskId), eq(scheduledTaskRuns.orgId, tenant.orgId), eq(scheduledTaskRuns.userId, tenant.userId))).orderBy(desc(scheduledTaskRuns.startedAt)).limit(50);
    return { task, runs };
  });

  app.get("/:taskId/runs/:runId", async (request) => {
    const tenant = tenantOf(request);
    const { taskId, runId } = z.object({ taskId: z.string().uuid(), runId: z.string().uuid() }).parse(request.params);
    const run = await app.db.query.scheduledTaskRuns.findFirst({ where: and(eq(scheduledTaskRuns.id, runId), eq(scheduledTaskRuns.taskId, taskId), eq(scheduledTaskRuns.orgId, tenant.orgId), eq(scheduledTaskRuns.userId, tenant.userId)) });
    if (!run) throw notFound();
    return { run };
  });

  app.post("/", async (request, reply) => {
    const tenant = tenantOf(request);
    const body = taskBody.parse(request.body);
    assertFuture(body.scheduledFor);
    const recurrenceConfig = validateRecurrence(body.recurrenceType, body.recurrenceConfig);
    const url = await assertSafeCrawlUrl(body.url);
    const [task] = await app.db.insert(scheduledTasks).values({ orgId: tenant.orgId, userId: tenant.userId, title: body.title, instruction: body.instruction, url: url.toString(), scheduledFor: body.scheduledFor, recurrenceType: body.recurrenceType, recurrenceConfig, timezone: body.timezone, source: "manual" }).returning();
    if (!task) throw new Error("Scheduled task insert failed");
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "scheduled_task.create", targetType: "scheduled_task", targetId: task.id, outcome: "success", details: { source: "manual", scheduledFor: body.scheduledFor.toISOString() } });
    return reply.status(201).send({ task });
  });

  app.post("/natural-language", async (request, reply) => {
    const tenant = tenantOf(request);
    const { content } = z.object({ content: z.string().trim().min(1).max(4_000) }).parse(request.body);
    const { spec, usage } = await interpretNaturalTask(app.config, content);
    assertFuture(spec.scheduledFor);
    const [task] = await app.db.insert(scheduledTasks).values({ orgId: tenant.orgId, userId: tenant.userId, title: spec.title, instruction: spec.instruction, url: spec.url, scheduledFor: spec.scheduledFor, recurrenceType: spec.recurrenceType, recurrenceConfig: spec.recurrenceConfig, timezone: app.config.APP_TIMEZONE, source: "conversation" }).returning();
    if (!task) throw new Error("Scheduled task insert failed");
    await recordParserUsage(app, tenant, usage);
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "scheduled_task.create", targetType: "scheduled_task", targetId: task.id, outcome: "success", details: { source: "conversation", scheduledFor: spec.scheduledFor.toISOString() } });
    return reply.status(201).send({ task });
  });

  app.patch("/:taskId", async (request) => {
    const tenant = tenantOf(request);
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const body = taskBody.parse(request.body);
    assertFuture(body.scheduledFor);
    const recurrenceConfig = validateRecurrence(body.recurrenceType, body.recurrenceConfig);
    const url = await assertSafeCrawlUrl(body.url);
    const [task] = await app.db.update(scheduledTasks).set({ title: body.title, instruction: body.instruction, url: url.toString(), scheduledFor: body.scheduledFor, recurrenceType: body.recurrenceType, recurrenceConfig, timezone: body.timezone, updatedAt: new Date() })
      .where(and(eq(scheduledTasks.id, taskId), eq(scheduledTasks.orgId, tenant.orgId), eq(scheduledTasks.userId, tenant.userId), eq(scheduledTasks.status, "scheduled"))).returning();
    if (!task) throw new AppError(409, "TASK_NOT_EDITABLE", "只有尚未执行的任务可以修改");
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "scheduled_task.update", targetType: "scheduled_task", targetId: task.id, outcome: "success" });
    return { task };
  });

  app.post("/:taskId/cancel", async (request) => {
    const tenant = tenantOf(request);
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const [task] = await app.db.update(scheduledTasks).set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(scheduledTasks.id, taskId), eq(scheduledTasks.orgId, tenant.orgId), eq(scheduledTasks.userId, tenant.userId), eq(scheduledTasks.status, "scheduled"))).returning();
    if (!task) throw new AppError(409, "TASK_NOT_CANCELLABLE", "这个任务已经开始执行，不能取消");
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "scheduled_task.cancel", targetType: "scheduled_task", targetId: task.id, outcome: "success" });
    return { task };
  });

  app.post("/:taskId/pause", async (request) => {
    const tenant = tenantOf(request);
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const now = new Date();
    const [task] = await app.db.update(scheduledTasks).set({ status: "paused", pausedAt: now, updatedAt: now })
      .where(and(eq(scheduledTasks.id, taskId), eq(scheduledTasks.orgId, tenant.orgId), eq(scheduledTasks.userId, tenant.userId), eq(scheduledTasks.status, "scheduled"))).returning();
    if (!task) throw new AppError(409, "TASK_NOT_PAUSABLE", "只有等待执行的循环任务可以暂停");
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "scheduled_task.pause", targetType: "scheduled_task", targetId: task.id, outcome: "success" });
    return { task };
  });

  app.post("/:taskId/resume", async (request) => {
    const tenant = tenantOf(request);
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const existing = await app.db.query.scheduledTasks.findFirst({ where: and(eq(scheduledTasks.id, taskId), eq(scheduledTasks.orgId, tenant.orgId), eq(scheduledTasks.userId, tenant.userId), eq(scheduledTasks.status, "paused")) });
    if (!existing) throw new AppError(409, "TASK_NOT_RESUMABLE", "只有已暂停的任务可以恢复");
    const now = new Date();
    const next = existing.scheduledFor > now ? existing.scheduledFor : existing.recurrenceType === "once" ? new Date(now.getTime() + 10_000) : nextOccurrence(existing.recurrenceType, existing.recurrenceConfig as RecurrenceConfig, existing.scheduledFor, now);
    const [task] = await app.db.update(scheduledTasks).set({ status: "scheduled", scheduledFor: next ?? new Date(now.getTime() + 10_000), pausedAt: null, updatedAt: now }).where(eq(scheduledTasks.id, existing.id)).returning();
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "scheduled_task.resume", targetType: "scheduled_task", targetId: existing.id, outcome: "success" });
    return { task };
  });

  app.post("/:taskId/end", async (request) => {
    const tenant = tenantOf(request);
    const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const now = new Date();
    const [task] = await app.db.update(scheduledTasks).set({ status: "cancelled", endedAt: now, finishedAt: now, updatedAt: now })
      .where(and(eq(scheduledTasks.id, taskId), eq(scheduledTasks.orgId, tenant.orgId), eq(scheduledTasks.userId, tenant.userId))).returning();
    if (!task) throw notFound();
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "scheduled_task.end", targetType: "scheduled_task", targetId: task.id, outcome: "success" });
    return { task };
  });
};

export default scheduledTaskRoutes;
