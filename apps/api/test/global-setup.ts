import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { resolve } from "node:path";

const databaseUrl = "postgres://codex:codex_local_only@127.0.0.1:5438/codex_wiki_test";

export default async function setup() {
  const admin = postgres("postgres://codex:codex_local_only@127.0.0.1:5438/postgres", { max: 1 });
  const existing = await admin`select 1 from pg_database where datname = 'codex_wiki_test'`;
  if (!existing.length) await admin.unsafe('create database "codex_wiki_test"');
  await admin.end();
  const client = postgres(databaseUrl, { max: 1 });
  await migrate(drizzle(client), { migrationsFolder: resolve("packages/database/migrations") });
  await client.end();
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = databaseUrl;
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.AGENT_PROXY_TOKEN = "test-agent-proxy-token-with-at-least-32-characters";
  process.env.DATA_ROOT = resolve("runtime/test-orgs");
  process.env.CODEX_HOME = resolve("runtime/test-codex-home");
  process.env.WEB_ORIGIN = "http://localhost:5173";
  process.env.LOG_LEVEL = "silent";
};
