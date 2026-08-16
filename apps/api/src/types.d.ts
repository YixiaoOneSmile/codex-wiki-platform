import type { Database } from "@cwp/database";
import type { TenantContext } from "@cwp/shared";
import type { AppConfig } from "./config.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    db: Database;
  }
  interface FastifyRequest {
    tenant: TenantContext | null;
    sessionId: string | null;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}
