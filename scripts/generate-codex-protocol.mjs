import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve("apps/api/src/generated/codex");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
execFileSync(process.env.CODEX_BIN || "codex", ["app-server", "generate-ts", "--out", output], {
  stdio: "inherit",
});
