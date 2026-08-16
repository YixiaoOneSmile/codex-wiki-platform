import { uploads, wikiPages, wikiPageVersions, wikiSpaces } from "@cwp/database";
import { canCreatePersonalWiki, canEditTeamWiki, type WikiScope } from "@cwp/shared";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError, forbidden, notFound } from "../lib/errors.js";
import { tenantOf } from "../lib/tenant.js";
import { writeAudit } from "../services/audit.js";
import { persistWikiPage, removeWikiPage } from "../services/wiki-files.js";
import { checksum } from "../lib/crypto.js";
import { randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import sanitizeFilename from "sanitize-filename";
import { extractText } from "unpdf";
import mammoth from "mammoth";

async function documentToMarkdown(buffer: Buffer, filename: string, mimeType: string) {
  const extension = extname(filename).toLowerCase();
  if (extension === ".md" || extension === ".markdown" || extension === ".txt" || mimeType.startsWith("text/")) return buffer.toString("utf8");
  if (extension === ".pdf" || mimeType === "application/pdf") {
    const result = await extractText(new Uint8Array(buffer), { mergePages: false });
    return (result.text as string[]).map((page, index) => `## 第 ${index + 1} 页\n\n${page.trim()}`).join("\n\n");
  }
  if (extension === ".docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return (await mammoth.extractRawText({ buffer })).value.trim();
  }
  throw new AppError(415, "UNSUPPORTED_DOCUMENT", "仅支持 Markdown、文本、PDF 和 DOCX 文件");
}

async function spaceFor(app: Parameters<FastifyPluginAsync>[0], tenant: ReturnType<typeof tenantOf>, scope: WikiScope) {
  if (scope === "personal" && !canCreatePersonalWiki(tenant)) throw forbidden();
  let space = await app.db.query.wikiSpaces.findFirst({
    where: scope === "team"
      ? and(eq(wikiSpaces.orgId, tenant.orgId), eq(wikiSpaces.scope, "team"))
      : and(eq(wikiSpaces.orgId, tenant.orgId), eq(wikiSpaces.scope, "personal"), eq(wikiSpaces.ownerUserId, tenant.userId)),
  });
  if (!space && scope === "personal") {
    [space] = await app.db.insert(wikiSpaces).values({ orgId: tenant.orgId, scope, ownerUserId: tenant.userId, name: "个人知识" }).returning();
  }
  if (!space) throw notFound();
  return space;
}

function requireWikiEdit(tenant: ReturnType<typeof tenantOf>, scope: WikiScope) {
  if (scope === "team" && !canEditTeamWiki(tenant)) throw forbidden();
  if (scope === "personal" && !canCreatePersonalWiki(tenant)) throw forbidden();
}

const wikiRoutes: FastifyPluginAsync = async (app) => {
  app.get("/spaces", async (request) => {
    const tenant = tenantOf(request);
    const spaces = await app.db.select().from(wikiSpaces).where(and(eq(wikiSpaces.orgId, tenant.orgId), or(eq(wikiSpaces.scope, "team"), eq(wikiSpaces.ownerUserId, tenant.userId)))).orderBy(asc(wikiSpaces.scope));
    return { spaces, personalWikiEnabled: tenant.personalWikiEnabled, canEditTeamWiki: canEditTeamWiki(tenant) };
  });

  app.get("/:scope/pages", async (request) => {
    const tenant = tenantOf(request);
    const { scope } = z.object({ scope: z.enum(["team", "personal"]) }).parse(request.params);
    const { q } = z.object({ q: z.string().trim().max(200).optional() }).parse(request.query);
    const space = await spaceFor(app, tenant, scope);
    const where = and(eq(wikiPages.orgId, tenant.orgId), eq(wikiPages.spaceId, space.id), sql`${wikiPages.deletedAt} is null`, q ? or(ilike(wikiPages.title, `%${q}%`), ilike(wikiPages.markdown, `%${q}%`)) : undefined);
    const pages = await app.db.select({ id: wikiPages.id, parentId: wikiPages.parentId, path: wikiPages.path, title: wikiPages.title, markdown: wikiPages.markdown, version: wikiPages.version, sourceType: wikiPages.sourceType, sourceName: wikiPages.sourceName, updatedAt: wikiPages.updatedAt }).from(wikiPages).where(where).orderBy(asc(wikiPages.path)).limit(q ? 50 : 500);
    return { space, pages };
  });

  app.post("/:scope/pages", async (request, reply) => {
    const tenant = tenantOf(request);
    const { scope } = z.object({ scope: z.enum(["team", "personal"]) }).parse(request.params);
    requireWikiEdit(tenant, scope);
    const body = z.object({ path: z.string().min(3).max(500), title: z.string().trim().min(1).max(200), markdown: z.string().max(2_000_000), parentId: z.string().uuid().nullable().optional(), sourceType: z.enum(["manual", "upload", "agent"]).default("manual"), sourceName: z.string().max(500).optional(), sourceChecksum: z.string().max(128).optional() }).parse(request.body);
    const space = await spaceFor(app, tenant, scope);
    const page = await app.db.transaction(async (tx) => {
      const [created] = await tx.insert(wikiPages).values({ orgId: tenant.orgId, spaceId: space.id, parentId: body.parentId ?? null, path: body.path, title: body.title, markdown: body.markdown, createdBy: tenant.userId, updatedBy: tenant.userId, sourceType: body.sourceType, sourceName: body.sourceName, sourceChecksum: body.sourceChecksum }).returning();
      if (!created) throw new Error("Page insert failed");
      await tx.insert(wikiPageVersions).values({ orgId: tenant.orgId, pageId: created.id, version: 1, title: created.title, markdown: created.markdown, changedBy: tenant.userId, changeSummary: "创建页面" });
      return created;
    });
    await persistWikiPage({ dataRoot: app.config.DATA_ROOT, orgId: tenant.orgId, scope, ownerUserId: scope === "personal" ? tenant.userId : null, path: page.path, title: page.title, markdown: page.markdown });
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "wiki.page.create", targetType: "wiki_page", targetId: page.id, outcome: "success", details: { scope, path: page.path } });
    return reply.status(201).send({ page });
  });

  app.post("/:scope/import", async (request, reply) => {
    const tenant = tenantOf(request);
    const { scope } = z.object({ scope: z.enum(["team", "personal"]) }).parse(request.params);
    requireWikiEdit(tenant, scope);
    const file = await request.file();
    if (!file) throw new AppError(400, "FILE_REQUIRED", "请选择要导入的文件");
    const buffer = await file.toBuffer();
    const sourceChecksum = checksum(buffer);
    const cleanName = sanitizeFilename(file.filename).slice(0, 240) || "document";
    const title = cleanName.replace(/\.[^.]+$/, "");
    const markdown = await documentToMarkdown(buffer, cleanName, file.mimetype);
    const storageKey = `${tenant.orgId}/${randomUUID()}${extname(cleanName).toLowerCase()}`;
    const storagePath = resolve(app.config.DATA_ROOT, tenant.orgId, "uploads", storageKey.split("/").at(-1)!);
    await mkdir(resolve(app.config.DATA_ROOT, tenant.orgId, "uploads"), { recursive: true, mode: 0o750 });
    await writeFile(storagePath, buffer, { mode: 0o640 });
    const [upload] = await app.db.insert(uploads).values({ orgId: tenant.orgId, userId: tenant.userId, storageKey, originalName: cleanName, mimeType: file.mimetype, sizeBytes: buffer.length, checksum: sourceChecksum }).returning();
    const space = await spaceFor(app, tenant, scope);
    const pagePath = `imports/${sanitizeFilename(title).replaceAll(" ", "-")}-${randomUUID().slice(0, 8)}.md`;
    const page = await app.db.transaction(async (tx) => {
      const [created] = await tx.insert(wikiPages).values({ orgId: tenant.orgId, spaceId: space.id, path: pagePath, title, markdown, sourceType: "upload", sourceName: cleanName, sourceChecksum, createdBy: tenant.userId, updatedBy: tenant.userId }).returning();
      if (!created) throw new Error("Imported page insert failed");
      await tx.insert(wikiPageVersions).values({ orgId: tenant.orgId, pageId: created.id, version: 1, title, markdown, changedBy: tenant.userId, changeSummary: `从 ${cleanName} 导入` });
      return created;
    });
    await persistWikiPage({ dataRoot: app.config.DATA_ROOT, orgId: tenant.orgId, scope, ownerUserId: scope === "personal" ? tenant.userId : null, path: page.path, title: page.title, markdown: page.markdown });
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "wiki.document.import", targetType: "wiki_page", targetId: page.id, outcome: "success", details: { scope, uploadId: upload?.id, sourceName: cleanName, sizeBytes: buffer.length } });
    return reply.status(201).send({ page, uploadId: upload?.id });
  });

  app.patch("/:scope/pages/:pageId", async (request) => {
    const tenant = tenantOf(request);
    const { scope, pageId } = z.object({ scope: z.enum(["team", "personal"]), pageId: z.string().uuid() }).parse(request.params);
    requireWikiEdit(tenant, scope);
    const body = z.object({ title: z.string().trim().min(1).max(200).optional(), markdown: z.string().max(2_000_000).optional(), changeSummary: z.string().max(300).optional() }).refine((v) => v.title !== undefined || v.markdown !== undefined).parse(request.body);
    const space = await spaceFor(app, tenant, scope);
    const existing = await app.db.query.wikiPages.findFirst({ where: and(eq(wikiPages.id, pageId), eq(wikiPages.orgId, tenant.orgId), eq(wikiPages.spaceId, space.id), sql`${wikiPages.deletedAt} is null`) });
    if (!existing) throw notFound();
    const nextVersion = existing.version + 1;
    const [page] = await app.db.update(wikiPages).set({ title: body.title ?? existing.title, markdown: body.markdown ?? existing.markdown, version: nextVersion, updatedBy: tenant.userId, updatedAt: new Date() }).where(and(eq(wikiPages.id, pageId), eq(wikiPages.orgId, tenant.orgId))).returning();
    if (!page) throw notFound();
    await app.db.insert(wikiPageVersions).values({ orgId: tenant.orgId, pageId, version: nextVersion, title: page.title, markdown: page.markdown, changedBy: tenant.userId, changeSummary: body.changeSummary ?? "更新页面" });
    await persistWikiPage({ dataRoot: app.config.DATA_ROOT, orgId: tenant.orgId, scope, ownerUserId: scope === "personal" ? tenant.userId : null, path: page.path, title: page.title, markdown: page.markdown });
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "wiki.page.update", targetType: "wiki_page", targetId: page.id, outcome: "success", details: { scope, version: nextVersion } });
    return { page };
  });

  app.get("/:scope/pages/:pageId/versions", async (request) => {
    const tenant = tenantOf(request);
    const { scope, pageId } = z.object({ scope: z.enum(["team", "personal"]), pageId: z.string().uuid() }).parse(request.params);
    const space = await spaceFor(app, tenant, scope);
    const page = await app.db.query.wikiPages.findFirst({ where: and(eq(wikiPages.id, pageId), eq(wikiPages.orgId, tenant.orgId), eq(wikiPages.spaceId, space.id)) });
    if (!page) throw notFound();
    const versions = await app.db.select().from(wikiPageVersions).where(and(eq(wikiPageVersions.orgId, tenant.orgId), eq(wikiPageVersions.pageId, pageId))).orderBy(desc(wikiPageVersions.version));
    return { versions };
  });

  app.delete("/:scope/pages/:pageId", async (request, reply) => {
    const tenant = tenantOf(request);
    const { scope, pageId } = z.object({ scope: z.enum(["team", "personal"]), pageId: z.string().uuid() }).parse(request.params);
    requireWikiEdit(tenant, scope);
    const space = await spaceFor(app, tenant, scope);
    const [page] = await app.db.update(wikiPages).set({ deletedAt: new Date(), updatedBy: tenant.userId, updatedAt: new Date() }).where(and(eq(wikiPages.id, pageId), eq(wikiPages.orgId, tenant.orgId), eq(wikiPages.spaceId, space.id), sql`${wikiPages.deletedAt} is null`)).returning();
    if (!page) throw notFound();
    await removeWikiPage({ dataRoot: app.config.DATA_ROOT, orgId: tenant.orgId, scope, ownerUserId: scope === "personal" ? tenant.userId : null, path: page.path });
    await writeAudit(app.db, { orgId: tenant.orgId, actorUserId: tenant.userId, correlationId: request.id, action: "wiki.page.delete", targetType: "wiki_page", targetId: page.id, outcome: "success", details: { scope, path: page.path } });
    return reply.status(204).send();
  });
};
export default wikiRoutes;
