import { agentRuns, usageEvents } from "@cwp/database";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { safeEqual } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import { streamDeepSeekAsResponses, type ResponsesRequest } from "../services/responses-adapter.js";

const proxyRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/responses", { config: { public: true }, bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    if (!safeEqual(token, app.config.AGENT_PROXY_TOKEN)) throw new AppError(401, "INVALID_PROXY_TOKEN", "无效的内部代理凭据");
    if (!app.config.DEEPSEEK_API_KEY) throw new AppError(503, "MODEL_NOT_CONFIGURED", "模型服务尚未配置");
    const body = z.object({ model: z.string().optional(), input: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]).optional(), instructions: z.string().optional(), tools: z.array(z.record(z.string(), z.unknown())).optional(), stream: z.boolean().optional(), parallel_tool_calls: z.boolean().optional() }).passthrough().parse(request.body) as ResponsesRequest;
    const runId = typeof request.headers["x-cwp-run-id"] === "string" ? request.headers["x-cwp-run-id"] : null;
    const userIsolationId = runId?.replaceAll("-", "") ?? "platform_internal";
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    const started = Date.now();
    try {
      const usage = await streamDeepSeekAsResponses({ body, apiKey: app.config.DEEPSEEK_API_KEY, baseUrl: app.config.DEEPSEEK_BASE_URL, model: app.config.DEEPSEEK_MODEL, userId: userIsolationId, write: (chunk) => reply.raw.write(chunk) });
      if (runId) {
        const run = await app.db.query.agentRuns.findFirst({ where: eq(agentRuns.id, runId) });
        if (run) {
          const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
          const cost = (uncached * app.config.DEEPSEEK_INPUT_PRICE_PER_MILLION + usage.cachedInputTokens * app.config.DEEPSEEK_CACHED_INPUT_PRICE_PER_MILLION + usage.outputTokens * app.config.DEEPSEEK_OUTPUT_PRICE_PER_MILLION) / 1_000_000;
          await app.db.insert(usageEvents).values({ orgId: run.orgId, userId: run.userId, conversationId: run.conversationId, runId: run.id, providerRequestId: usage.requestId, model: app.config.DEEPSEEK_MODEL, inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens, estimatedCost: cost.toFixed(8), latencyMs: Date.now() - started, success: true });
        }
      }
    } catch (error) {
      request.log.error({ err: error, runId }, "DeepSeek Responses adapter failed");
      const message = error instanceof Error ? error.message : "Adapter failed";
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ type: "error", code: "provider_error", message: message.replace(/sk-[a-z0-9_-]+/gi, "[REDACTED]"), param: null })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });
};
export default proxyRoutes;
