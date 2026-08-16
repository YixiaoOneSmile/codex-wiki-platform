import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { skills, wikiPages, wikiPageVersions, wikiSpaces, type Database } from "@cwp/database";
import { canEditTeamWiki, type TenantContext, type WikiScope } from "@cwp/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AppConfig } from "../config.js";

type Snapshot = { pageId: string; scope: WikiScope; path: string; title: string; markdown: string; version: number };
export type PreparedWorkspace = {
  cwd: string;
  snapshots: Map<string, Snapshot>;
  editableScopes: Set<WikiScope>;
  skillInstructions: Array<{ name: string; description: string; instructions: string }>;
};

function searchTerms(prompt: string) {
  const terms = new Set(prompt.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}|[\u3400-\u9fff]{2,}/g) ?? []);
  for (const sequence of [...terms]) {
    if (!/[\u3400-\u9fff]/.test(sequence)) continue;
    for (let index = 0; index < sequence.length - 1; index += 1) terms.add(sequence.slice(index, index + 2));
  }
  return [...terms].filter((term) => !["请查", "告诉", "什么", "怎么", "一下", "根据", "说明", "定义", "相关", "页面", "查找", "搜索", "回答", "原文", "参考", "团队", "知识", "知识库", "项目"].includes(term));
}

export function buildAuthorizedWikiContext(prepared: PreparedWorkspace, prompt: string, maxCharacters = 200_000) {
  const terms = searchTerms(prompt);
  const scored = [...prepared.snapshots.values()].map((page) => {
    const titleAndPath = `${page.title}\n${page.path}`.toLowerCase();
    const body = page.markdown.toLowerCase();
    const score = terms.reduce((total, term) => total + (titleAndPath.includes(term) ? 5 : 0) + (body.includes(term) ? 1 : 0), 0);
    return { page, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.page.path.localeCompare(b.page.path));
  const minimumScore = Math.max(1, Math.ceil((scored[0]?.score ?? 0) * 0.15));
  const matches = scored.filter(({ score }) => score >= minimumScore).slice(0, 20);
  const result: Array<{ id: string; scope: WikiScope; path: string; title: string; markdown: string }> = [];
  for (const { page } of matches) {
    const candidate = [...result, { id: page.pageId, scope: page.scope, path: page.path, title: page.title, markdown: page.markdown }];
    if (JSON.stringify(candidate).length > maxCharacters) break;
    result.push(candidate.at(-1)!);
  }
  return JSON.stringify(result).replaceAll("<", "\\u003c");
}

export function buildAgentTurnPrompt(prompt: string, authorizedWikiContext: string) {
  const payload = {
    userMessage: prompt,
    authorizedWikiPages: JSON.parse(authorizedWikiContext) as Array<{ id: string; scope: WikiScope; path: string; title: string; markdown: string }>,
  };
  return [
    "以下 <current_turn_payload> 由平台生成。请回答其中的 userMessage；authorizedWikiPages 是本轮按当前用户权限全文匹配出的 Wiki 完整页面，也是本轮唯一有效的 Wiki 检索结果。",
    "<current_turn_payload>",
    JSON.stringify(payload).replaceAll("<", "\\u003c"),
    "</current_turn_payload>",
  ].join("\n");
}

function assertContained(base: string, target: string) {
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error("Unsafe workspace path");
}

function pageFile(root: string, scope: WikiScope, pagePath: string) {
  const base = resolve(root, "knowledge", scope);
  const target = resolve(base, pagePath);
  assertContained(base, target);
  return target;
}

function serializePage(title: string, markdown: string) {
  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${markdown.trim()}\n`;
}

function parsePage(content: string, fallbackTitle: string) {
  const match = content.match(/^---\s*\ntitle:\s*(.+?)\n---\s*\n+/);
  let title = fallbackTitle;
  if (match?.[1]) {
    try { title = JSON.parse(match[1]) as string; } catch { title = match[1].trim(); }
  }
  return { title, markdown: match ? content.slice(match[0].length).trim() : content.trim() };
}

async function markdownFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const target = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") result.push(target);
    }
  }
  await visit(root);
  return result;
}

export async function prepareAgentWorkspace(db: Database, config: AppConfig, tenant: TenantContext, conversationId: string): Promise<PreparedWorkspace> {
  const cwd = resolve(config.DATA_ROOT, tenant.orgId, "agent-users", tenant.userId, "conversations", conversationId);
  const dataRoot = resolve(config.DATA_ROOT);
  assertContained(dataRoot, cwd);
  const knowledgeRoot = resolve(cwd, "knowledge");
  await rm(knowledgeRoot, { recursive: true, force: true });
  await rm(resolve(cwd, ".agents", "skills"), { recursive: true, force: true });
  await mkdir(resolve(knowledgeRoot, "team"), { recursive: true, mode: 0o750 });
  if (tenant.personalWikiEnabled) await mkdir(resolve(knowledgeRoot, "personal"), { recursive: true, mode: 0o750 });
  const spaces = await db.select().from(wikiSpaces).where(and(eq(wikiSpaces.orgId, tenant.orgId), sql`${wikiSpaces.scope} = 'team' or ${wikiSpaces.ownerUserId} = ${tenant.userId}`));
  const visibleIds = spaces.filter((space) => space.scope === "team" || (space.scope === "personal" && tenant.personalWikiEnabled)).map((space) => space.id);
  const pages = visibleIds.length
    ? await db.select().from(wikiPages).where(and(eq(wikiPages.orgId, tenant.orgId), inArray(wikiPages.spaceId, visibleIds), sql`${wikiPages.deletedAt} is null`))
    : [];
  const spaceMap = new Map(spaces.map((space) => [space.id, space]));
  const snapshots = new Map<string, Snapshot>();
  for (const page of pages) {
    const scope = spaceMap.get(page.spaceId)?.scope;
    if (!scope) continue;
    const target = pageFile(cwd, scope, page.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o750 });
    await writeFile(target, serializePage(page.title, page.markdown), { encoding: "utf8", mode: 0o640 });
    snapshots.set(target, { pageId: page.id, scope, path: page.path, title: page.title, markdown: page.markdown, version: page.version });
  }
  await writeFile(resolve(cwd, "README.md"), "# 工作区\n\n`knowledge/team` 是团队 Wiki，`knowledge/personal` 是你的个人 Wiki。\n", "utf8");
  const enabledSkills = await db.select().from(skills).where(and(eq(skills.orgId, tenant.orgId), eq(skills.enabled, true)));
  for (const skill of enabledSkills) {
    const skillRoot = resolve(cwd, ".agents", "skills", skill.slug);
    assertContained(cwd, skillRoot);
    await mkdir(skillRoot, { recursive: true, mode: 0o750 });
    await writeFile(resolve(skillRoot, "SKILL.md"), `---\nname: ${JSON.stringify(skill.name)}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.instructions.trim()}\n`, { encoding: "utf8", mode: 0o640 });
  }
  return {
    cwd,
    snapshots,
    editableScopes: new Set<WikiScope>([...(canEditTeamWiki(tenant) ? ["team" as const] : []), ...(tenant.personalWikiEnabled ? ["personal" as const] : [])]),
    skillInstructions: enabledSkills.map(({ name, description, instructions }) => ({ name, description, instructions })),
  };
}

export async function reconcileAgentWiki(db: Database, prepared: PreparedWorkspace, tenant: TenantContext) {
  for (const scope of prepared.editableScopes) {
    const scopeRoot = resolve(prepared.cwd, "knowledge", scope);
    for (const file of await markdownFiles(scopeRoot)) {
      const pagePath = relative(scopeRoot, file).replaceAll(sep, "/");
      const snapshot = prepared.snapshots.get(file);
      const parsed = parsePage(await readFile(file, "utf8"), snapshot?.title ?? pagePath.replace(/\.md$/, ""));
      if (snapshot && parsed.title === snapshot.title && parsed.markdown === snapshot.markdown) continue;
      if (snapshot) {
        const nextVersion = snapshot.version + 1;
        await db.transaction(async (tx) => {
          await tx.update(wikiPages).set({ title: parsed.title, markdown: parsed.markdown, version: nextVersion, updatedBy: tenant.userId, updatedAt: new Date() }).where(and(eq(wikiPages.id, snapshot.pageId), eq(wikiPages.orgId, tenant.orgId)));
          await tx.insert(wikiPageVersions).values({ orgId: tenant.orgId, pageId: snapshot.pageId, version: nextVersion, title: parsed.title, markdown: parsed.markdown, changedBy: tenant.userId, changeSummary: "由智能助手更新" });
        });
      } else {
        const space = await db.query.wikiSpaces.findFirst({ where: scope === "team" ? and(eq(wikiSpaces.orgId, tenant.orgId), eq(wikiSpaces.scope, "team")) : and(eq(wikiSpaces.orgId, tenant.orgId), eq(wikiSpaces.scope, "personal"), eq(wikiSpaces.ownerUserId, tenant.userId)) });
        if (!space) continue;
        await db.transaction(async (tx) => {
          const [created] = await tx.insert(wikiPages).values({ orgId: tenant.orgId, spaceId: space.id, path: pagePath, title: parsed.title, markdown: parsed.markdown, sourceType: "agent", createdBy: tenant.userId, updatedBy: tenant.userId }).returning();
          if (created) await tx.insert(wikiPageVersions).values({ orgId: tenant.orgId, pageId: created.id, version: 1, title: created.title, markdown: created.markdown, changedBy: tenant.userId, changeSummary: "由智能助手创建" });
        });
      }
    }
  }
}
