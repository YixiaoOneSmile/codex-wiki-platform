import "dotenv/config";
import { buildApp } from "./app.js";

const app = await buildApp();
await app.listen({ host: app.config.API_HOST, port: app.config.API_PORT });
