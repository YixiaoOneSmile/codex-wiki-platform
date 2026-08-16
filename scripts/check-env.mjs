import "dotenv/config";

const databaseUrl = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DOCKER;
const required = ["SESSION_SECRET", "AGENT_PROXY_TOKEN", "DEEPSEEK_API_KEY"];
const missing = required.filter((name) => !process.env[name]);
if (!databaseUrl) missing.unshift("DATABASE_URL or DATABASE_URL_DOCKER");
const weak = ["SESSION_SECRET", "AGENT_PROXY_TOKEN"].filter((name) => (process.env[name]?.length ?? 0) < 32);
const placeholders = required.filter((name) => /replace|example|change.?me/i.test(process.env[name] ?? ""));
const productionProblems = [];
if (process.env.NODE_ENV === "production") {
  if (!process.env.WEB_ORIGIN?.startsWith("https://")) productionProblems.push("WEB_ORIGIN must use HTTPS in production");
}
if (missing.length || weak.length || placeholders.length || productionProblems.length) {
  if (missing.length) console.error(`Missing required settings: ${missing.join(", ")}`);
  if (weak.length) console.error(`Settings must contain at least 32 characters: ${weak.join(", ")}`);
  if (placeholders.length) console.error(`Replace placeholder values: ${placeholders.join(", ")}`);
  for (const problem of productionProblems) console.error(problem);
  process.exit(1);
}
console.log("Environment preflight passed; secret values were not printed.");
