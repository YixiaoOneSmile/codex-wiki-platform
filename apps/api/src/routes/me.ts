import { memberships, organizations, users } from "@cwp/database";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { unauthorized } from "../lib/errors.js";

const meRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request) => {
    if (!request.tenant) throw unauthorized();
    const [user, orgs] = await Promise.all([
      app.db.query.users.findFirst({ columns: { id: true, email: true, displayName: true, isSuperAdmin: true, mustChangePassword: true }, where: eq(users.id, request.tenant.userId) }),
      app.db.select({ id: organizations.id, slug: organizations.slug, displayName: organizations.displayName, logoUrl: organizations.logoUrl, accentColor: organizations.accentColor, role: memberships.role, teamWikiRole: memberships.teamWikiRole, personalWikiEnabled: organizations.personalWikiEnabled })
        .from(memberships).innerJoin(organizations, eq(organizations.id, memberships.orgId)).where(eq(memberships.userId, request.tenant.userId)),
    ]);
    return { user, activeOrgId: request.tenant.orgId, organizations: orgs };
  });
};
export default meRoutes;
