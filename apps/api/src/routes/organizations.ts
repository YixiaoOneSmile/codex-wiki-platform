import { memberships, organizations, users } from "@cwp/database";
import { canManageOrganization } from "@cwp/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { hash } from "@node-rs/argon2";
import { sessions, wikiSpaces } from "@cwp/database";
import { AppError, forbidden, notFound } from "../lib/errors.js";
import { tenantOf } from "../lib/tenant.js";
import { writeAudit } from "../services/audit.js";

const organizationRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (request, reply) => {
    const tenant = tenantOf(request);
    if (!request.sessionId) throw forbidden();
    if (!tenant.isSuperAdmin) {
      await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "organization.create", targetType: "organization", outcome: "denied", details: { reason: "super_admin_required" } });
      throw forbidden();
    }
    const body = z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,47}$/), displayName: z.string().trim().min(2).max(80) }).parse(request.body);
    const org = await app.db.transaction(async (tx) => {
      const [created] = await tx.insert(organizations).values({ slug: body.slug, displayName: body.displayName }).returning();
      if (!created) throw new Error("Organization insert failed");
      await tx.insert(memberships).values({ orgId: created.id, userId: tenant.userId, role: "owner", teamWikiRole: "editor" });
      await tx.insert(wikiSpaces).values({ orgId: created.id, scope: "team", name: "团队知识" });
      await tx.update(sessions).set({ activeOrgId: created.id, lastSeenAt: new Date() }).where(eq(sessions.id, request.sessionId!));
      return created;
    });
    await writeAudit(app.db, { orgId: org.id, actorUserId: tenant.userId, correlationId: request.id, action: "organization.create", targetType: "organization", targetId: org.id, outcome: "success" });
    return reply.status(201).send({ organization: org });
  });
  app.get("/current", async (request) => {
    const tenant = tenantOf(request);
    const org = await app.db.query.organizations.findFirst({ where: eq(organizations.id, tenant.orgId) });
    if (!org) throw notFound();
    return { organization: org };
  });

  app.patch("/current", async (request) => {
    const tenant = tenantOf(request);
    if (!canManageOrganization(tenant)) throw forbidden();
    const body = z.object({
      displayName: z.string().trim().min(2).max(80).optional(),
      logoUrl: z.string().url().nullable().optional(),
      accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
      personalWikiEnabled: z.boolean().optional(),
    }).refine((value) => Object.keys(value).length > 0).parse(request.body);
    const [org] = await app.db.update(organizations).set({ ...body, updatedAt: new Date() }).where(eq(organizations.id, tenant.orgId)).returning();
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "organization.update", targetType: "organization", targetId: tenant.orgId, outcome: "success", details: { fields: Object.keys(body) } });
    return { organization: org };
  });

  app.get("/current/members", async (request) => {
    const tenant = tenantOf(request);
    if (!canManageOrganization(tenant)) throw forbidden();
    const rows = await app.db.select({ id: users.id, email: users.email, displayName: users.displayName, role: memberships.role, teamWikiRole: memberships.teamWikiRole, createdAt: memberships.createdAt })
      .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.orgId, tenant.orgId));
    return { members: rows };
  });

  app.post("/current/members", async (request, reply) => {
    const tenant = tenantOf(request);
    if (!canManageOrganization(tenant)) throw forbidden();
    const body = z.object({ email: z.string().email(), displayName: z.string().trim().min(2).max(80), temporaryPassword: z.string().min(10).max(200).optional(), role: z.enum(["admin", "member"]).default("member"), teamWikiRole: z.enum(["editor", "user"]).default("user") }).parse(request.body);
    const email = body.email.trim().toLowerCase();
    let user = await app.db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      if (!body.temporaryPassword) throw new AppError(400, "TEMPORARY_PASSWORD_REQUIRED", "新用户需要设置至少 10 位的临时密码");
      [user] = await app.db.insert(users).values({ email, displayName: body.displayName, passwordHash: await hash(body.temporaryPassword), mustChangePassword: true }).returning();
    }
    if (!user) throw new Error("User insert failed");
    const existing = await app.db.query.memberships.findFirst({ where: and(eq(memberships.orgId, tenant.orgId), eq(memberships.userId, user.id)) });
    if (existing) throw new AppError(409, "MEMBER_EXISTS", "该用户已经是组织成员");
    const [member] = await app.db.insert(memberships).values({ orgId: tenant.orgId, userId: user.id, role: body.role, teamWikiRole: body.teamWikiRole }).returning();
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "membership.create", targetType: "user", targetId: user.id, outcome: "success", details: { role: body.role, teamWikiRole: body.teamWikiRole } });
    return reply.status(201).send({ member: { ...member, id: user.id, email: user.email, displayName: user.displayName } });
  });

  app.patch("/current/members/:userId", async (request) => {
    const tenant = tenantOf(request);
    if (!canManageOrganization(tenant)) throw forbidden();
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = z.object({ role: z.enum(["owner", "admin", "member"]).optional(), teamWikiRole: z.enum(["editor", "user"]).optional() }).refine((value) => Object.keys(value).length > 0).parse(request.body);
    if (body.role === "owner" && tenant.orgRole !== "owner") throw forbidden();
    const [member] = await app.db.update(memberships).set({ ...body, updatedAt: new Date() }).where(and(eq(memberships.orgId, tenant.orgId), eq(memberships.userId, userId))).returning();
    if (!member) throw notFound();
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "membership.update", targetType: "user", targetId: userId, outcome: "success", details: { fields: Object.keys(body) } });
    return { member };
  });
};
export default organizationRoutes;
