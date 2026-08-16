import { skills } from "@cwp/database";
import { canManageOrganization } from "@cwp/shared";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { forbidden, notFound } from "../lib/errors.js";
import { tenantOf } from "../lib/tenant.js";
import { writeAudit } from "../services/audit.js";

const skillBody = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/), name: z.string().trim().min(2).max(80), description: z.string().trim().min(10).max(500), instructions: z.string().trim().min(20).max(100_000), enabled: z.boolean().default(true) });
const skillRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request) => {
    const tenant = tenantOf(request);
    const rows = await app.db.select({ id: skills.id, slug: skills.slug, name: skills.name, description: skills.description, instructions: skills.instructions, enabled: skills.enabled, updatedAt: skills.updatedAt }).from(skills).where(eq(skills.orgId, tenant.orgId)).orderBy(asc(skills.name));
    return { skills: rows, canManage: canManageOrganization(tenant) };
  });
  app.post("/", async (request, reply) => {
    const tenant = tenantOf(request); if (!canManageOrganization(tenant)) throw forbidden();
    const body = skillBody.parse(request.body);
    const [skill] = await app.db.insert(skills).values({ ...body, orgId: tenant.orgId, createdBy: tenant.userId, updatedBy: tenant.userId }).returning();
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "skill.create", targetType: "skill", targetId: skill?.id ?? null, outcome: "success", details: { slug: body.slug } });
    return reply.status(201).send({ skill });
  });
  app.patch("/:skillId", async (request) => {
    const tenant = tenantOf(request); if (!canManageOrganization(tenant)) throw forbidden();
    const { skillId } = z.object({ skillId: z.string().uuid() }).parse(request.params);
    const body = skillBody.partial().refine((value) => Object.keys(value).length > 0).parse(request.body);
    const [skill] = await app.db.update(skills).set({ ...body, updatedBy: tenant.userId, updatedAt: new Date() }).where(and(eq(skills.id, skillId), eq(skills.orgId, tenant.orgId))).returning();
    if (!skill) throw notFound();
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "skill.update", targetType: "skill", targetId: skill.id, outcome: "success", details: { fields: Object.keys(body) } });
    return { skill };
  });
};
export default skillRoutes;
