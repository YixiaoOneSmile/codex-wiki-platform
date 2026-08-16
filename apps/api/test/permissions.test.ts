import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hash } from "@node-rs/argon2";
import { createDatabase, memberships, organizations, users, wikiSpaces } from "@cwp/database";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

const databaseUrl = "postgres://codex:codex_local_only@127.0.0.1:5438/codex_wiki_test";
let app: FastifyInstance;
let dbHandle: ReturnType<typeof createDatabase>;
let orgAId: string;
let orgBId: string;
let ownerCookie: string;
let superAdminCookie: string;
let readerCookie: string;
let outsiderCookie: string;
let pageId: string;

async function login(email: string, password: string, orgSlug: string) {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password, orgSlug } });
  expect(response.statusCode).toBe(200);
  const cookie = response.cookies.find((item) => item.name === "cwp_session");
  if (!cookie) throw new Error("Missing session cookie");
  return `cwp_session=${cookie.value}`;
}

beforeAll(async () => {
  dbHandle = createDatabase(databaseUrl, 1);
  await dbHandle.client.unsafe("truncate table scheduled_tasks, audit_logs, behavior_events, usage_events, messages, agent_runs, conversations, wiki_page_versions, wiki_pages, wiki_spaces, skills, uploads, sessions, memberships, organizations, users restart identity cascade");
  const passwordHash = await hash("CorrectHorse123!");
  const [owner, superAdmin, reader, outsider] = await dbHandle.db.insert(users).values([
    { email: "owner-a@example.com", displayName: "Owner A", passwordHash, mustChangePassword: false },
    { email: "super-admin@example.com", displayName: "Super Admin", passwordHash, isSuperAdmin: true, mustChangePassword: false },
    { email: "reader-a@example.com", displayName: "Reader A", passwordHash, mustChangePassword: false },
    { email: "outsider-b@example.com", displayName: "Outsider B", passwordHash, mustChangePassword: false },
  ]).returning();
  const [orgA, orgB] = await dbHandle.db.insert(organizations).values([
    { slug: "org-a", displayName: "Organization A", personalWikiEnabled: false },
    { slug: "org-b", displayName: "Organization B", personalWikiEnabled: true },
  ]).returning();
  if (!owner || !superAdmin || !reader || !outsider || !orgA || !orgB) throw new Error("Fixture creation failed");
  orgAId = orgA.id; orgBId = orgB.id;
  await dbHandle.db.insert(memberships).values([
    { orgId: orgA.id, userId: owner.id, role: "owner", teamWikiRole: "editor" },
    { orgId: orgA.id, userId: superAdmin.id, role: "admin", teamWikiRole: "editor" },
    { orgId: orgA.id, userId: reader.id, role: "member", teamWikiRole: "user" },
    { orgId: orgB.id, userId: outsider.id, role: "owner", teamWikiRole: "editor" },
  ]);
  await dbHandle.db.insert(wikiSpaces).values([
    { orgId: orgA.id, scope: "team", name: "A Team Wiki" },
    { orgId: orgB.id, scope: "team", name: "B Team Wiki" },
  ]);
  const { buildApp } = await import("../src/app.js");
  app = await buildApp(); await app.ready();
  ownerCookie = await login("owner-a@example.com", "CorrectHorse123!", "org-a");
  superAdminCookie = await login("super-admin@example.com", "CorrectHorse123!", "org-a");
  readerCookie = await login("reader-a@example.com", "CorrectHorse123!", "org-a");
  outsiderCookie = await login("outsider-b@example.com", "CorrectHorse123!", "org-b");
});

afterAll(async () => { await app.close(); await dbHandle.client.end(); });

describe("tenant and wiki authorization", () => {
  it("lets an editor create a team Wiki page", async () => {
    const response = await app.inject({ method: "POST", url: "/api/wiki/team/pages", headers: { cookie: ownerCookie }, payload: { path: "handbook/start.md", title: "A-only handbook", markdown: "Secret A knowledge" } });
    expect(response.statusCode).toBe(201);
    pageId = response.json().page.id;
  });

  it("does not expose pages from another organization", async () => {
    const list = await app.inject({ method: "GET", url: "/api/wiki/team/pages", headers: { cookie: outsiderCookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().pages).toHaveLength(0);
    const direct = await app.inject({ method: "GET", url: `/api/wiki/team/pages/${pageId}/versions`, headers: { cookie: outsiderCookie } });
    expect(direct.statusCode).toBe(404);
  });

  it("rejects team Wiki writes from use-only members", async () => {
    const response = await app.inject({ method: "POST", url: "/api/wiki/team/pages", headers: { cookie: readerCookie }, payload: { path: "forbidden.md", title: "Forbidden", markdown: "Must not persist" } });
    expect(response.statusCode).toBe(403);
  });

  it("rejects personal Wiki creation when the organization disabled it", async () => {
    const response = await app.inject({ method: "POST", url: "/api/wiki/personal/pages", headers: { cookie: readerCookie }, payload: { path: "private.md", title: "Private", markdown: "No personal Wiki here" } });
    expect(response.statusCode).toBe(403);
  });

  it("keeps organization branding scoped", async () => {
    const update = await app.inject({ method: "PATCH", url: "/api/organizations/current", headers: { cookie: ownerCookie }, payload: { displayName: "A Renamed" } });
    expect(update.statusCode).toBe(200);
    const outsider = await app.inject({ method: "GET", url: "/api/organizations/current", headers: { cookie: outsiderCookie } });
    expect(outsider.json().organization.displayName).toBe("Organization B");
    expect(outsider.json().organization.id).toBe(orgBId);
    expect(outsider.json().organization.id).not.toBe(orgAId);
  });

  it("rejects organization creation from an organization owner who is not a platform super administrator", async () => {
    const response = await app.inject({ method: "POST", url: "/api/organizations", headers: { cookie: ownerCookie }, payload: { slug: "owner-created", displayName: "Owner Created" } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
    expect(await dbHandle.db.query.organizations.findFirst({ where: eq(organizations.slug, "owner-created") })).toBeUndefined();
  });

  it("allows only a platform super administrator to create an organization", async () => {
    const response = await app.inject({ method: "POST", url: "/api/organizations", headers: { cookie: superAdminCookie }, payload: { slug: "super-created", displayName: "Super Created" } });
    expect(response.statusCode).toBe(201);
    expect(response.json().organization.slug).toBe("super-created");
  });

  it("blocks product APIs until a temporary password is changed", async () => {
    const [temporaryUser] = await dbHandle.db.insert(users).values({ email: "temporary@example.com", displayName: "Temporary", passwordHash: await hash("Temporary123!"), mustChangePassword: true }).returning();
    if (!temporaryUser) throw new Error("Temporary user fixture failed");
    await dbHandle.db.insert(memberships).values({ orgId: orgAId, userId: temporaryUser.id, role: "member", teamWikiRole: "user" });
    const cookie = await login("temporary@example.com", "Temporary123!", "org-a");
    const blocked = await app.inject({ method: "GET", url: "/api/wiki/team/pages", headers: { cookie } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.mustChangePassword).toBe(true);
    const changed = await app.inject({ method: "POST", url: "/api/auth/change-password", headers: { cookie }, payload: { currentPassword: "Temporary123!", newPassword: "PermanentPassword123!" } });
    expect(changed.statusCode).toBe(200);
    const allowed = await app.inject({ method: "GET", url: "/api/wiki/team/pages", headers: { cookie } });
    expect(allowed.statusCode).toBe(200);
  });

  it("creates, isolates, and cancels a scheduled crawl task", async () => {
    const scheduledFor = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const created = await app.inject({ method: "POST", url: "/api/scheduled-tasks", headers: { cookie: readerCookie }, payload: { title: "Example crawl", instruction: "保存正文", url: "https://93.184.216.34/", scheduledFor } });
    expect(created.statusCode).toBe(201);
    expect(created.json().task.status).toBe("scheduled");
    const taskId = created.json().task.id as string;

    const ownerList = await app.inject({ method: "GET", url: "/api/scheduled-tasks", headers: { cookie: ownerCookie } });
    expect(ownerList.statusCode).toBe(200);
    expect(ownerList.json().tasks.some((task: { id: string }) => task.id === taskId)).toBe(false);

    const cancelled = await app.inject({ method: "POST", url: `/api/scheduled-tasks/${taskId}/cancel`, headers: { cookie: readerCookie } });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().task.status).toBe("cancelled");
  });

  it("blocks scheduled crawls to internal network addresses", async () => {
    const response = await app.inject({ method: "POST", url: "/api/scheduled-tasks", headers: { cookie: readerCookie }, payload: { title: "Unsafe crawl", instruction: "抓取", url: "http://127.0.0.1:4100/health", scheduledFor: new Date(Date.now() + 60 * 60 * 1000).toISOString() } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("UNSAFE_CRAWL_URL");
  });

  it("invalidates the session when a user logs out", async () => {
    const loggedOut = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: readerCookie } });
    expect(loggedOut.statusCode).toBe(200);
    expect(loggedOut.cookies.find((item) => item.name === "cwp_session")?.value).toBe("");

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: readerCookie } });
    expect(me.statusCode).toBe(401);
  });
});
