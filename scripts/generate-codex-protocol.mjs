import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const version = readFileSync(resolve(".codex-version"), "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid .codex-version: ${version}`);

const output = resolve(process.argv[2] || "apps/api/src/generated/codex");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const configuredBin = process.env.CODEX_BIN;
if (configuredBin) {
  execFileSync(configuredBin, ["app-server", "generate-ts", "--out", output], { stdio: "inherit" });
} else {
  execFileSync(
    "npm",
    [
      "exec",
      "--yes",
      `--package=@openai/codex@${version}`,
      "--",
      "codex",
      "app-server",
      "generate-ts",
      "--out",
      output,
    ],
    { stdio: "inherit" },
  );
}
console.log(`Generated Codex ${version} app-server protocol at ${output}`);
