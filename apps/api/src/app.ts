import Fastify from "fastify";
import { z, ZodError } from "zod";
import { AppError } from "./lib/errors.js";
import { safeLogValue } from "./lib/redact.js";
import authPlugin from "./plugins/auth.js";
import corePlugin from "./plugins/core.js";
import authRoutes from "./routes/auth.js";
import meRoutes from "./routes/me.js";
import organizationRoutes from "./routes/organizations.js";
import wikiRoutes from "./routes/wiki.js";
import eventRoutes from "./routes/events.js";
import proxyRoutes from "./routes/internal-proxy.js";
import conversationRoutes from "./routes/conversations.js";
import analyticsRoutes from "./routes/analytics.js";
import skillRoutes from "./routes/skills.js";
import scheduledTaskRoutes from "./routes/scheduled-tasks.js";
import { registerTaskScheduler } from "./services/task-scheduler.js";

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"] },
    genReqId: (request) => {
      const supplied = request.headers["x-correlation-id"];
      return typeof supplied === "string" && z.string().uuid().safeParse(supplied).success ? supplied : crypto.randomUUID();
    },
  });
  await app.register(corePlugin);
  await app.register(authPlugin);
  app.setErrorHandler((error, request, reply) => {
    const normalized = error instanceof Error ? error : new Error("Unknown error");
    const known = error instanceof AppError;
    const validation = error instanceof ZodError;
    const statusCode = known ? error.statusCode : validation ? 400 : 500;
    const code = known ? error.code : validation ? "INVALID_REQUEST" : "INTERNAL_ERROR";
    request.log[statusCode >= 500 ? "error" : "warn"]({ err: safeLogValue(normalized), correlationId: request.id }, normalized.message);
    return reply.status(statusCode).send({ error: { code, message: statusCode === 500 ? "服务暂时不可用" : normalized.message, correlationId: request.id } });
  });
  app.get("/health", { config: { public: true } }, async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(meRoutes, { prefix: "/api/me" });
  await app.register(organizationRoutes, { prefix: "/api/organizations" });
  await app.register(wikiRoutes, { prefix: "/api/wiki" });
  await app.register(eventRoutes, { prefix: "/api/events" });
  await app.register(proxyRoutes, { prefix: "/internal/deepseek" });
  await app.register(conversationRoutes, { prefix: "/api/conversations" });
  await app.register(analyticsRoutes, { prefix: "/api/admin" });
  await app.register(skillRoutes, { prefix: "/api/skills" });
  await app.register(scheduledTaskRoutes, { prefix: "/api/scheduled-tasks" });
  registerTaskScheduler(app);

  return app;
}
