import { auditLogs, behaviorEvents, usageEvents, users } from "@cwp/database";
import { canManageOrganization } from "@cwp/shared";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { forbidden } from "../lib/errors.js";
import { tenantOf } from "../lib/tenant.js";

const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/usage", async (request) => {
    const tenant = tenantOf(request);
    if (!canManageOrganization(tenant)) throw forbidden();
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(request.query);
    const since = new Date(Date.now() - days * 86_400_000);
    const [totals, byUser] = await Promise.all([
      app.db.select({ requests: sql<number>`count(*)::int`, successful: sql<number>`count(*) filter (where ${usageEvents.success})::int`, inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`, outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`, estimatedCost: sql<string>`coalesce(sum(${usageEvents.estimatedCost}), 0)::text`, averageLatencyMs: sql<number>`coalesce(avg(${usageEvents.latencyMs}), 0)::int` }).from(usageEvents).where(and(eq(usageEvents.orgId, tenant.orgId), gte(usageEvents.createdAt, since))),
      app.db.select({ userId: users.id, displayName: users.displayName, email: users.email, requests: sql<number>`count(*)::int`, inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`, outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`, estimatedCost: sql<string>`coalesce(sum(${usageEvents.estimatedCost}), 0)::text` }).from(usageEvents).innerJoin(users, eq(users.id, usageEvents.userId)).where(and(eq(usageEvents.orgId, tenant.orgId), gte(usageEvents.createdAt, since))).groupBy(users.id, users.displayName, users.email).orderBy(desc(sql`count(*)`)),
    ]);
    return { days, totals: totals[0], byUser };
  });

  app.get("/audit", async (request) => {
    const tenant = tenantOf(request);
    if (!canManageOrganization(tenant)) throw forbidden();
    const rows = await app.db.select({ id: auditLogs.id, correlationId: auditLogs.correlationId, action: auditLogs.action, targetType: auditLogs.targetType, targetId: auditLogs.targetId, outcome: auditLogs.outcome, details: auditLogs.details, createdAt: auditLogs.createdAt, actorName: users.displayName }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).where(eq(auditLogs.orgId, tenant.orgId)).orderBy(desc(auditLogs.createdAt)).limit(200);
    return { audit: rows };
  });

  app.get("/behavior", async (request) => {
    const tenant = tenantOf(request);
    if (!canManageOrganization(tenant)) throw forbidden();
    const rows = await app.db.select({ name: behaviorEvents.name, count: sql<number>`count(*)::int`, uniqueUsers: sql<number>`count(distinct ${behaviorEvents.userId})::int` }).from(behaviorEvents).where(and(eq(behaviorEvents.orgId, tenant.orgId), gte(behaviorEvents.createdAt, new Date(Date.now() - 30 * 86_400_000)))).groupBy(behaviorEvents.name).orderBy(desc(sql`count(*)`));
    return { events: rows };
  });
};
export default analyticsRoutes;
