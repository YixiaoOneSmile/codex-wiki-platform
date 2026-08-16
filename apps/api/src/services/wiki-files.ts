import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { WikiScope } from "@cwp/shared";
import { AppError } from "../lib/errors.js";

function safeWikiPath(dataRoot: string, orgId: string, scope: WikiScope, ownerUserId: string | null, pagePath: string) {
  const normalized = pagePath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized.endsWith(".md") || normalized.includes("..") || !/^[\p{L}\p{N}_.\-/ ]+\.md$/u.test(normalized)) {
    throw new AppError(400, "INVALID_WIKI_PATH", "Wiki 路径必须是安全的 Markdown 文件路径");
  }
  const base = resolve(dataRoot, orgId, "wiki", scope === "team" ? "team" : `personal/${ownerUserId}`);
  const target = resolve(base, normalized);
  if (!target.startsWith(`${base}${sep}`)) throw new AppError(400, "INVALID_WIKI_PATH", "Wiki 路径无效");
  return target;
}

export async function persistWikiPage(input: { dataRoot: string; orgId: string; scope: WikiScope; ownerUserId: string | null; path: string; title: string; markdown: string; }) {
  const target = safeWikiPath(input.dataRoot, input.orgId, input.scope, input.ownerUserId, input.path);
  await mkdir(dirname(target), { recursive: true });
  const frontmatter = `---\ntitle: ${JSON.stringify(input.title)}\n---\n\n`;
  await writeFile(target, `${frontmatter}${input.markdown.trim()}\n`, { encoding: "utf8", mode: 0o640 });
}

export async function removeWikiPage(input: { dataRoot: string; orgId: string; scope: WikiScope; ownerUserId: string | null; path: string; }) {
  await rm(safeWikiPath(input.dataRoot, input.orgId, input.scope, input.ownerUserId, input.path), { force: true });
}
