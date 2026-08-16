import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDatabase(url: string, max = 10) {
  const client = postgres(url, { max, prepare: false });
  return { db: drizzle(client, { schema }), client };
}

export type Database = ReturnType<typeof createDatabase>["db"];
export * from "./schema.js";
