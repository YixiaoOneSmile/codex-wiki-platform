import { memberships, organizations, sessions, users } from "@cwp/database";
import { and, eq, gt } from "drizzle-orm";
import fp from "fastify-plugin";
import { hashToken } from "../lib/crypto.js";
import { AppError, unauthorized } from "../lib/errors.js";

export const SESSION_COOKIE = "cwp_session";

export default fp(async (app) => {
  app.decorateRequest("tenant", null);
  app.decorateRequest("sessionId", null);

  app.addHook("onRequest", async (request) => {
    if (request.routeOptions.config.public) return;
    const token = request.cookies[SESSION_COOKIE];
    if (!token) throw unauthorized();
    const tokenHash = hashToken(token, app.config.SESSION_SECRET);
    const result = await app.db
      .select({
        sessionId: sessions.id,
        userId: users.id,
        isSuperAdmin: users.isSuperAdmin,
        orgId: organizations.id,
        orgRole: memberships.role,
        teamWikiRole: memberships.teamWikiRole,
        personalWikiEnabled: organizations.personalWikiEnabled,
        mustChangePassword: users.mustChangePassword,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(organizations, eq(organizations.id, sessions.activeOrgId))
      .innerJoin(memberships, and(eq(memberships.orgId, sessions.activeOrgId), eq(memberships.userId, sessions.userId)))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
      .limit(1);
    const row = result[0];
    if (!row) throw unauthorized();
    request.sessionId = row.sessionId;
    request.tenant = {
      userId: row.userId,
      isSuperAdmin: row.isSuperAdmin,
      orgId: row.orgId,
      orgRole: row.orgRole,
      teamWikiRole: row.teamWikiRole,
      personalWikiEnabled: row.personalWikiEnabled,
      mustChangePassword: row.mustChangePassword,
    };
    if (row.mustChangePassword && !["/api/me", "/api/auth/change-password", "/api/auth/logout"].includes(request.url.split("?")[0] ?? "")) {
      throw new AppError(403, "PASSWORD_CHANGE_REQUIRED", "首次登录必须先修改临时密码");
    }
  });
});
