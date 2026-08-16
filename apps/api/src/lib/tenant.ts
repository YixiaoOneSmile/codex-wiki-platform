import type { FastifyRequest } from "fastify";
import { unauthorized } from "./errors.js";

export function tenantOf(request: FastifyRequest) {
  if (!request.tenant) throw unauthorized();
  return request.tenant;
}
