import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  DATA_ROOT: z.string().default("./runtime/orgs"),
  CODEX_HOME: z.string().default("./runtime/codex-home"),
  CODEX_BIN: z.string().default("codex"),
  AGENT_PROXY_TOKEN: z.string().min(32),
  AGENT_SHELL_ENABLED: z.string().default("false").transform((value) => value === "true"),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-v4-flash"),
  DEEPSEEK_INPUT_PRICE_PER_MILLION: z.coerce.number().min(0).default(0),
  DEEPSEEK_CACHED_INPUT_PRICE_PER_MILLION: z.coerce.number().min(0).default(0),
  DEEPSEEK_OUTPUT_PRICE_PER_MILLION: z.coerce.number().min(0).default(0),
  APP_TIMEZONE: z.string().default("Asia/Shanghai"),
  CRAWL4AI_URL: z.string().url().default("http://crawl4ai:11235"),
  CRAWL4AI_API_TOKEN: z.preprocess((value) => value === "" ? undefined : value, z.string().min(32).optional()),
  CRAWL4AI_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(10 * 60 * 1000).default(180_000),
  SCHEDULER_POLL_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  LOG_LEVEL: z.string().default("info"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.parse(source);
  return {
    ...parsed,
    DATA_ROOT: resolve(parsed.DATA_ROOT),
    CODEX_HOME: resolve(parsed.CODEX_HOME),
  };
}
