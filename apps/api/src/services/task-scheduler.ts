import { scheduledTaskRuns, scheduledTasks } from "@cwp/database";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { crawlPage } from "./crawl4ai.js";
import { writeAudit } from "./audit.js";
import { nextOccurrence, type RecurrenceConfig } from "./task-recurrence.js";

async function claimNextTask(app: FastifyInstance) {
  return app.db.transaction(async (tx) => {
    const [task] = await tx.select().from(scheduledTasks)
      .where(and(eq(scheduledTasks.status, "scheduled"), lt(scheduledTasks.scheduledFor, new Date())))
      .orderBy(asc(scheduledTasks.scheduledFor)).limit(1).for("update", { skipLocked: true });
    if (!task) return null;
    const [claimed] = await tx.update(scheduledTasks).set({ status: "running", startedAt: new Date(), errorMessage: null, updatedAt: new Date() })
      .where(and(eq(scheduledTasks.id, task.id), eq(scheduledTasks.status, "scheduled"))).returning();
    if (!claimed) return null;
    const [run] = await tx.insert(scheduledTaskRuns).values({ taskId: claimed.id, orgId: claimed.orgId, userId: claimed.userId, scheduledFor: claimed.scheduledFor }).returning();
    return run ? { task: claimed, run } : null;
  });
}

async function finishTask(app: FastifyInstance, task: typeof scheduledTasks.$inferSelect, runId: string, result: { markdown?: string; metadata?: Record<string, unknown>; error?: string }) {
  const finishedAt = new Date();
  const succeeded = result.markdown !== undefined;
  await app.db.update(scheduledTaskRuns).set({
    status: succeeded ? "completed" : "failed",
    resultMarkdown: result.markdown,
    resultMetadata: result.metadata ?? {},
    errorMessage: result.error,
    finishedAt,
    updatedAt: finishedAt,
  }).where(eq(scheduledTaskRuns.id, runId));

  const current = await app.db.query.scheduledTasks.findFirst({ where: eq(scheduledTasks.id, task.id) });
  if (!current) return;
  const recurring = current.recurrenceType !== "once";
  const next = recurring ? nextOccurrence(current.recurrenceType, current.recurrenceConfig as RecurrenceConfig, task.scheduledFor, finishedAt) : null;
  const interrupted = current.status === "paused" || current.status === "cancelled";
  await app.db.update(scheduledTasks).set({
    status: interrupted ? current.status : recurring ? "scheduled" : succeeded ? "completed" : "failed",
    scheduledFor: next ?? current.scheduledFor,
    resultMarkdown: result.markdown,
    resultMetadata: result.metadata ?? {},
    errorMessage: result.error ?? null,
    finishedAt,
    lastRunAt: finishedAt,
    runCount: sql`${scheduledTasks.runCount} + 1`,
    startedAt: null,
    updatedAt: finishedAt,
  }).where(eq(scheduledTasks.id, task.id));
}

async function executeTask(app: FastifyInstance, claimed: NonNullable<Awaited<ReturnType<typeof claimNextTask>>>) {
  const { task, run } = claimed;
  const correlationId = randomUUID();
  try {
    const result = await crawlPage(app.config, task.url);
    await finishTask(app, task, run.id, { markdown: result.markdown, metadata: result.metadata });
    await writeAudit(app.db, { orgId: task.orgId, actorUserId: task.userId, correlationId, action: "scheduled_task.completed", targetType: "scheduled_task", targetId: task.id, outcome: "success", details: { url: task.url, characterCount: result.markdown.length } });
    app.log.info({ taskId: task.id, orgId: task.orgId }, "Scheduled crawl task completed");
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1_000) : "任务执行失败";
    await finishTask(app, task, run.id, { error: message });
    await writeAudit(app.db, { orgId: task.orgId, actorUserId: task.userId, correlationId, action: "scheduled_task.failed", targetType: "scheduled_task", targetId: task.id, outcome: "failure", details: { message } });
    app.log.error({ err: error, taskId: task.id }, "Scheduled crawl task failed");
  }
}

export function registerTaskScheduler(app: FastifyInstance) {
  let timer: NodeJS.Timeout | null = null;
  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      for (let count = 0; count < 5; count += 1) {
        const claimed = await claimNextTask(app);
        if (!claimed) break;
        await executeTask(app, claimed);
      }
    } catch (error) { app.log.error({ err: error }, "Scheduled task polling failed"); }
    finally { polling = false; }
  };
  app.addHook("onReady", async () => {
    await app.db.update(scheduledTasks).set({ status: "scheduled", startedAt: null, updatedAt: new Date() })
      .where(and(eq(scheduledTasks.status, "running"), lt(scheduledTasks.startedAt, new Date(Date.now() - 10 * 60 * 1000))));
    timer = setInterval(() => { void poll(); }, app.config.SCHEDULER_POLL_MS);
    timer.unref();
    void poll();
  });
  app.addHook("onClose", async () => { if (timer) clearInterval(timer); });
}
