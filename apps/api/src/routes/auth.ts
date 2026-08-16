import { memberships, organizations, sessions, users } from "@cwp/database";
import { hash, verify } from "@node-rs/argon2";
import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { hashIp, hashToken, randomToken } from "../lib/crypto.js";
import { AppError, forbidden, unauthorized } from "../lib/errors.js";
import { writeAudit } from "../services/audit.js";
import { SESSION_COOKIE } from "../plugins/auth.js";

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/login", { config: { public: true, rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { body: { type: "object" } } }, async (request, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(8), orgSlug: z.string().optional() }).parse(request.body);
    const email = body.email.trim().toLowerCase();
    const user = await app.db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user || !(await verify(user.passwordHash, body.password))) throw new AppError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确");
    const memberRows = await app.db.select({ orgId: organizations.id, slug: organizations.slug })
      .from(memberships).innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, user.id));
    const active = body.orgSlug ? memberRows.find((row) => row.slug === body.orgSlug) : memberRows[0];
    if (!active) throw forbidden();
    const token = randomToken();
    const [session] = await app.db.insert(sessions).values({
      tokenHash: hashToken(token, app.config.SESSION_SECRET), userId: user.id, activeOrgId: active.orgId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), userAgent: request.headers["user-agent"]?.slice(0, 300),
      ipHash: hashIp(request.ip, app.config.SESSION_SECRET),
    }).returning({ id: sessions.id });
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: app.config.NODE_ENV === "production", path: "/", maxAge: 30 * 24 * 60 * 60 });
    await writeAudit(app.db, { orgId: active.orgId, actorUserId: user.id, correlationId: request.id, action: "auth.login", targetType: "session", targetId: session?.id ?? null, outcome: "success" });
    return { ok: true };
  });

  app.post("/logout", async (request, reply) => {
    if (!request.sessionId || !request.tenant) throw unauthorized();
    await app.db.delete(sessions).where(eq(sessions.id, request.sessionId));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    await writeAudit(app.db, { orgId: request.tenant.orgId, actorUserId: request.tenant.userId, correlationId: request.id, action: "auth.logout", targetType: "session", targetId: request.sessionId, outcome: "success" });
    return { ok: true };
  });

  app.post("/switch-organization", async (request) => {
    if (!request.sessionId || !request.tenant) throw unauthorized();
    const { orgId } = z.object({ orgId: z.string().uuid() }).parse(request.body);
    const member = await app.db.query.memberships.findFirst({ where: and(eq(memberships.orgId, orgId), eq(memberships.userId, request.tenant.userId)) });
    if (!member) throw forbidden();
    await app.db.update(sessions).set({ activeOrgId: orgId, lastSeenAt: new Date() }).where(eq(sessions.id, request.sessionId));
    await writeAudit(app.db, { orgId, actorUserId: request.tenant.userId, correlationId: request.id, action: "auth.switch_org", targetType: "organization", targetId: orgId, outcome: "success" });
    return { ok: true };
  });

  app.post("/change-password", async (request) => {
    if (!request.tenant) throw unauthorized();
    const body = z.object({ currentPassword: z.string().min(8), newPassword: z.string().min(12).max(200) }).refine((value) => value.currentPassword !== value.newPassword, { message: "新密码不能与当前密码相同" }).parse(request.body);
    const user = await app.db.query.users.findFirst({ where: eq(users.id, request.tenant.userId) });
    if (!user || !(await verify(user.passwordHash, body.currentPassword))) throw new AppError(400, "INVALID_CURRENT_PASSWORD", "当前密码不正确");
    await app.db.update(users).set({ passwordHash: await hash(body.newPassword), mustChangePassword: false, updatedAt: new Date() }).where(eq(users.id, user.id));
    await writeAudit(app.db, { orgId: request.tenant.orgId, actorUserId: user.id, correlationId: request.id, action: "auth.password_change", targetType: "user", targetId: user.id, outcome: "success" });
    return { ok: true };
  });
};

export default authRoutes;
