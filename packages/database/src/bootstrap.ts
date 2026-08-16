import { config } from "dotenv";
import { hash } from "@node-rs/argon2";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createDatabase } from "./index.js";
import { memberships, organizations, users, wikiSpaces } from "./schema.js";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });

const input = z.object({
  DATABASE_URL: z.string().min(1),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email(),
  BOOTSTRAP_ADMIN_DISPLAY_NAME: z.string().trim().min(1).max(100),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(200),
  BOOTSTRAP_ORG_SLUG: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/),
  BOOTSTRAP_ORG_NAME: z.string().trim().min(1).max(100),
}).parse(process.env);

const { db, client } = createDatabase(input.DATABASE_URL, 1);
try {
  const email = input.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase();
  const existingUser = await db.query.users.findFirst({ where: eq(users.email, email) });
  const existingOrg = await db.query.organizations.findFirst({ where: eq(organizations.slug, input.BOOTSTRAP_ORG_SLUG) });
  if (existingUser || existingOrg) {
    if (!existingUser || !existingOrg) throw new Error("Bootstrap email or organization slug is already used by different data; choose new values");
    const existingMembership = await db.query.memberships.findFirst({ where: and(eq(memberships.userId, existingUser.id), eq(memberships.orgId, existingOrg.id)) });
    if (!existingMembership || existingMembership.role !== "owner") throw new Error("Existing bootstrap records are not a matching owner membership");
    if (!existingUser.isSuperAdmin) await db.update(users).set({ isSuperAdmin: true, updatedAt: new Date() }).where(eq(users.id, existingUser.id));
    console.log("Bootstrap owner already exists and is a platform super administrator.");
  } else {
    await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({
        email,
        displayName: input.BOOTSTRAP_ADMIN_DISPLAY_NAME,
        passwordHash: await hash(input.BOOTSTRAP_ADMIN_PASSWORD),
        isSuperAdmin: true,
        mustChangePassword: true,
      }).returning();
      const [org] = await tx.insert(organizations).values({
        slug: input.BOOTSTRAP_ORG_SLUG,
        displayName: input.BOOTSTRAP_ORG_NAME,
        personalWikiEnabled: false,
      }).returning();
      if (!user || !org) throw new Error("Bootstrap insert failed");
      await tx.insert(memberships).values({ orgId: org.id, userId: user.id, role: "owner", teamWikiRole: "editor" });
      await tx.insert(wikiSpaces).values({ orgId: org.id, scope: "team", name: "团队知识" });
    });
    console.log("Bootstrap owner and organization created. The owner must change the temporary password at first login.");
  }
} finally {
  await client.end();
}
