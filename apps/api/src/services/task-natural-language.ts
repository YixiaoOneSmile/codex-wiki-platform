import { z } from "zod";
import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { assertSafeCrawlUrl } from "./crawl4ai.js";
import { recurrenceFromNaturalLanguage, type RecurrenceConfig, type RecurrenceType } from "./task-recurrence.js";

export type NaturalTaskSpec = { title: string; instruction: string; url: string; scheduledFor: Date; recurrenceType: RecurrenceType; recurrenceConfig: RecurrenceConfig };
export type NaturalTaskUsage = { requestId: string | null; inputTokens: number; cachedInputTokens: number; outputTokens: number; latencyMs: number };

const responseSchema = z.object({
  valid: z.boolean(),
  title: z.string().trim().max(120).optional(),
  instruction: z.string().trim().max(2_000).optional(),
  url: z.string().trim().optional(),
  scheduledFor: z.string().trim().optional(),
  reason: z.string().optional(),
});

export function looksLikeScheduledCrawl(content: string): boolean {
  return /https?:\/\//i.test(content) && /(定时|任务|抓取|爬取|采集|明天|后天|今天|稍后|每天|每日|每周|每星期|每月|每隔|\d{1,2}\s*[点时:])/i.test(content);
}

function parseJsonContent(content: string): unknown {
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(stripped);
}

function fallbackTaskContent(content: string): z.infer<typeof responseSchema> | null {
  const url = content.match(/https?:\/\/[^\s，。；;]+/i)?.[0];
  if (!url || !/每隔\s*\d{1,4}\s*(分钟?|小时|天)/.test(content)) return null;
  const hostname = (() => { try { return new URL(url).hostname; } catch { return "网页"; } })();
  return { valid: true, title: `定时抓取 ${hostname}`, instruction: "抓取网页并保存为 Markdown", url };
}

const relativeUnitMs: Record<string, number> = {
  秒: 1_000,
  秒钟: 1_000,
  分: 60_000,
  分钟: 60_000,
  小时: 60 * 60_000,
  天: 24 * 60 * 60_000,
};

export function resolveScheduledFor(content: string, modelValue: string | undefined, now: Date): Date {
  const relative = content.match(/(\d{1,4})\s*(秒钟?|分钟?|小时|天)\s*(?:后|之后)/);
  if (relative?.[1] && relative[2]) {
    const amount = Number(relative[1]);
    const unitMs = relativeUnitMs[relative[2]];
    if (amount > 0 && unitMs) return new Date(now.getTime() + amount * unitMs);
  }
  const recurringInterval = content.match(/每隔\s*(\d{1,4})\s*(分钟?|小时|天)/);
  if (recurringInterval?.[1] && recurringInterval[2]) {
    const factor = recurringInterval[2].startsWith("小时") ? 60 : recurringInterval[2] === "天" ? 1_440 : 1;
    return new Date(now.getTime() + Number(recurringInterval[1]) * factor * 60_000);
  }

  if (!modelValue) throw new AppError(400, "INVALID_SCHEDULE_TIME", "没有识别到执行时间，请使用“10分钟后”或“明天下午3点”等明确表达");
  const normalized = modelValue
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/, "$1T$2")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const hasExplicitOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized);
  const timestamp = hasExplicitOffset ? Date.parse(normalized) : Number.NaN;
  if (!Number.isFinite(timestamp)) throw new AppError(400, "INVALID_SCHEDULE_TIME", "没有识别到有效执行时间，请使用“10分钟后”或“明天下午3点”等明确表达");
  return new Date(timestamp);
}

export async function interpretNaturalTask(config: AppConfig, content: string, now = new Date()): Promise<{ spec: NaturalTaskSpec; usage: NaturalTaskUsage }> {
  if (!config.DEEPSEEK_API_KEY) throw new AppError(503, "MODEL_NOT_CONFIGURED", "模型服务尚未配置，暂时无法解析自然语言任务");
  const started = Date.now();
  const response = await fetch(`${config.DEEPSEEK_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: config.DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: `你是网页抓取任务解析器。当前时间是 ${now.toISOString()}，用户时区是 ${config.APP_TIMEZONE}。接受一次性或循环任务，必须包含明确执行时间（循环任务为首次执行时间）和一个公开 HTTP/HTTPS URL。返回 JSON：{"valid":boolean,"title":string,"instruction":string,"url":string,"scheduledFor":带时区ISO8601,"reason":string}。不要输出 JSON 之外的内容。instruction 保留用户希望如何处理网页的要求；title 简洁。对于“每隔N小时”等表达，scheduledFor 是从当前时间起N小时后的首次执行时间。` },
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      stream: false,
      max_tokens: 800,
      user_id: "scheduled_task_parser",
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new AppError(502, "TASK_PARSE_FAILED", `自然语言任务解析失败（${response.status}）`);
  let payload: Record<string, any>;
  try { payload = JSON.parse(raw) as Record<string, any>; } catch { throw new AppError(502, "TASK_PARSE_FAILED", "自然语言任务解析失败"); }
  let modelContent: unknown;
  try { modelContent = parseJsonContent(String(payload.choices?.[0]?.message?.content ?? "")); } catch { modelContent = null; }
  const modelResult = responseSchema.safeParse(modelContent);
  const parsed = modelResult.success ? modelResult.data : fallbackTaskContent(content);
  if (!parsed) throw new AppError(502, "TASK_PARSE_FAILED", "助手没有返回有效的任务信息，请重试");
  if (!parsed.valid || !parsed.title || !parsed.instruction || !parsed.url) throw new AppError(400, "INCOMPLETE_SCHEDULED_TASK", parsed.reason || "请同时说明执行时间和要抓取的网页地址");
  const safeUrl = await assertSafeCrawlUrl(parsed.url);
  const recurrence = recurrenceFromNaturalLanguage(content);
  const scheduledFor = resolveScheduledFor(content, parsed.scheduledFor, now);
  if (scheduledFor.getTime() <= now.getTime() + 5_000) throw new AppError(400, "INVALID_SCHEDULE_TIME", "执行时间必须晚于当前时间");
  if (scheduledFor.getTime() > now.getTime() + 366 * 24 * 60 * 60 * 1_000) throw new AppError(400, "INVALID_SCHEDULE_TIME", "暂时只能创建未来一年内的任务");
  const usage = payload.usage ?? {};
  return {
    spec: { title: parsed.title, instruction: parsed.instruction, url: safeUrl.toString(), scheduledFor, recurrenceType: recurrence.type, recurrenceConfig: recurrence.config },
    usage: {
      requestId: typeof payload.id === "string" ? payload.id : null,
      inputTokens: Number(usage.prompt_tokens ?? 0),
      cachedInputTokens: Number(usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0),
      outputTokens: Number(usage.completion_tokens ?? 0),
      latencyMs: Date.now() - started,
    },
  };
}
