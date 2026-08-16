import { config } from "dotenv";
import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { createDatabase } from "./index.js";
import { memberships, organizations, users, wikiSpaces } from "./schema.js";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const { db, client } = createDatabase(process.env.DATABASE_URL, 1);
const email = "owner@example.com";
const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
if (existing) {
  if (!existing.isSuperAdmin) await db.update(users).set({ isSuperAdmin: true, updatedAt: new Date() }).where(eq(users.id, existing.id));
} else {
  await db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({
      email,
      displayName: "演示管理员",
      passwordHash: await hash("ChangeMe123!"),
      isSuperAdmin: true,
      mustChangePassword: false,
    }).returning();
    const [org] = await tx.insert(organizations).values({
      slug: "demo",
      displayName: "演示助手",
      personalWikiEnabled: true,
    }).returning();
    if (!user || !org) throw new Error("Seed insert failed");
    await tx.insert(memberships).values({ orgId: org.id, userId: user.id, role: "owner", teamWikiRole: "editor" });
    await tx.insert(wikiSpaces).values({ orgId: org.id, scope: "team", name: "团队知识" });
  });
  console.log("Seeded owner@example.com / ChangeMe123! (development only)");
}
await client.end();
