import { behaviorEvents } from "@cwp/database";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { tenantOf } from "../lib/tenant.js";

const allowedEvents = ["page.view", "chat.create", "chat.send", "wiki.search", "wiki.open", "settings.open", "error.ui"] as const;
const eventRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (request, reply) => {
    const tenant = tenantOf(request);
    const body = z.object({ name: z.enum(allowedEvents), route: z.string().max(300).optional(), properties: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).default({}) }).parse(request.body);
    await app.db.insert(behaviorEvents).values({ orgId: tenant.orgId, userId: tenant.userId, sessionId: request.sessionId, name: body.name, route: body.route, properties: body.properties });
    return reply.status(202).send({ accepted: true });
  });
};
export default eventRoutes;
