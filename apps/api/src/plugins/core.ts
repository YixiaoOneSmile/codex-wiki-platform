import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { createDatabase } from "@cwp/database";
import fp from "fastify-plugin";
import { loadConfig } from "../config.js";

export default fp(async (app) => {
  const config = loadConfig();
  const { db, client } = createDatabase(config.DATABASE_URL);
  app.decorate("config", config);
  app.decorate("db", db);
  app.addHook("onClose", async () => client.end());
  await app.register(cookie);
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 5 } });
});
