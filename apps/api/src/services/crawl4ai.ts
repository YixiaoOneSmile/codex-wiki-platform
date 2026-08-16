import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "../lib/errors.js";
import type { AppConfig } from "../config.js";

function blockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113);
}

function blockedIp(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (isIP(normalized) === 4) return blockedIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized.startsWith("::ffff:")) return blockedIpv4(normalized.slice(7));
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8");
}

function dnsProxyIpv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return a === 198 && (b === 18 || b === 19);
}

export async function assertSafeCrawlUrl(value: string): Promise<URL> {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError(400, "INVALID_CRAWL_URL", "请输入有效的网页地址"); }
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password) throw new AppError(400, "INVALID_CRAWL_URL", "只允许抓取公开的 HTTP 或 HTTPS 网页");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new AppError(400, "UNSAFE_CRAWL_URL", "不能抓取本机或内部网络地址");
  const literalHost = isIP(hostname) !== 0;
  const addresses = literalHost ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length) throw new AppError(400, "CRAWL_HOST_UNRESOLVED", "无法解析这个网页地址");
  if (addresses.some(({ address }) => blockedIp(address) && !(!literalHost && dnsProxyIpv4(address)))) throw new AppError(400, "UNSAFE_CRAWL_URL", "不能抓取本机或内部网络地址");
  url.hash = "";
  return url;
}

function markdownOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  return [object.fit_markdown, object.raw_markdown, object.markdown_with_citations, object.markdown]
    .find((item) => typeof item === "string" && item.trim().length > 0) as string ?? "";
}

function firstResult(payload: Record<string, unknown>): Record<string, unknown> {
  const results = payload.results;
  if (Array.isArray(results) && results[0] && typeof results[0] === "object") return results[0] as Record<string, unknown>;
  if (payload.result && typeof payload.result === "object") return payload.result as Record<string, unknown>;
  if (payload.data && typeof payload.data === "object") return payload.data as Record<string, unknown>;
  return payload;
}

async function requestJson(url: string, init: RequestInit, timeoutMs: number): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  if (!response.ok) {
    if (/(anti-bot protection|PerimeterX block|Cloudflare.*block|Access Denied)/i.test(text)) {
      throw new AppError(502, "CRAWL_BLOCKED_BY_SITE", "目标网站启用了反自动化保护，当前无法直接抓取。请改用网站公开的 RSS、API 或其他获授权的数据来源");
    }
    throw new Error(`Crawl4AI ${response.status}: ${text.slice(0, 500)}`);
  }
  try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new Error("Crawl4AI 返回了无法识别的数据"); }
}

function retryableBrowserLaunch(error: unknown): boolean {
  return error instanceof Error
    && /^Crawl4AI 5\d\d:/s.test(error.message)
    && /(BrowserType\.launch|Target page, context or browser has been closed)/i.test(error.message);
}

export async function crawlPage(config: AppConfig, rawUrl: string): Promise<{ markdown: string; metadata: Record<string, unknown> }> {
  const url = await assertSafeCrawlUrl(rawUrl);
  const baseUrl = config.CRAWL4AI_URL.replace(/\/$/, "");
  const token = config.CRAWL4AI_API_TOKEN ?? config.AGENT_PROXY_TOKEN;
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  const crawlRequest = () => requestJson(`${baseUrl}/crawl`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        urls: [url.toString()],
        browser_config: { type: "BrowserConfig", params: { headless: true } },
        crawler_config: { type: "CrawlerRunConfig", params: { stream: false, cache_mode: "bypass", check_robots_txt: true, page_timeout: 90_000 } },
      }),
    }, config.CRAWL4AI_TIMEOUT_MS);
  let payload: Record<string, unknown>;
  let browserLaunchRetries = 0;
  try {
    payload = await crawlRequest();
  } catch (error) {
    if (!retryableBrowserLaunch(error)) throw error;
    browserLaunchRetries = 1;
    await new Promise((resolve) => setTimeout(resolve, 750));
    try {
      payload = await crawlRequest();
    } catch (retryError) {
      if (retryableBrowserLaunch(retryError)) throw new Error("爬虫浏览器连续两次启动失败，请稍后重试或联系管理员", { cause: retryError });
      throw retryError;
    }
  }
  if (typeof payload.task_id === "string" && !payload.results) {
    const taskId = payload.task_id;
    const deadline = Date.now() + config.CRAWL4AI_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      payload = await requestJson(`${baseUrl}/task/${encodeURIComponent(taskId)}`, { headers }, Math.min(15_000, config.CRAWL4AI_TIMEOUT_MS));
      if (payload.status === "completed") break;
      if (payload.status === "failed") throw new Error(typeof payload.error === "string" ? payload.error : "网页抓取失败");
    }
  }
  const result = firstResult(payload);
  if (result.success === false) throw new Error(typeof result.error_message === "string" ? result.error_message : "网页抓取失败");
  const markdown = markdownOf(result.markdown) || markdownOf(result.cleaned_html) || markdownOf(payload.markdown);
  if (!markdown.trim()) throw new Error("网页抓取完成，但没有获得可用正文");
  return {
    markdown: markdown.slice(0, 2_000_000),
    metadata: {
      requestedUrl: url.toString(),
      finalUrl: typeof result.url === "string" ? result.url : url.toString(),
      title: typeof result.metadata === "object" && result.metadata && typeof (result.metadata as Record<string, unknown>).title === "string" ? (result.metadata as Record<string, unknown>).title : null,
      statusCode: typeof result.status_code === "number" ? result.status_code : null,
      characterCount: markdown.length,
      truncated: markdown.length > 2_000_000,
      browserLaunchRetries,
    },
  };
}
