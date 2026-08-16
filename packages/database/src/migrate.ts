import { config } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "./index.js";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const { db, client } = createDatabase(process.env.DATABASE_URL, 1);
await migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
await client.end();
