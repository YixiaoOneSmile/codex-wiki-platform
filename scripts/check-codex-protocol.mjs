import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { clearTimeout, setTimeout } from "node:timers";

const version = readFileSync(resolve(".codex-version"), "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid .codex-version: ${version}`);

const output = mkdtempSync(join(tmpdir(), "codex-wiki-protocol-"));
const child = spawn(
  "npm",
  [
    "exec",
    "--yes",
    `--package=@openai/codex@${version}`,
    "--",
    "codex",
    "app-server",
    "--stdio",
    "-c",
    "analytics.enabled=false",
  ],
  {
    stdio: ["pipe", "pipe", "pipe"],
  },
);
const lines = createInterface({ input: child.stdout });
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-4000);
});

const initialized = new Promise((resolvePromise, rejectPromise) => {
  const timer = setTimeout(
    () => rejectPromise(new Error(`Codex initialize timed out: ${stderr}`)),
    30_000,
  );
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== 1) return;
    clearTimeout(timer);
    if (message.error)
      rejectPromise(new Error(`Codex initialize failed: ${JSON.stringify(message.error)}`));
    else resolvePromise(message.result);
  });
  child.once("error", rejectPromise);
  child.once("exit", (code) => {
    if (code && code !== 0) rejectPromise(new Error(`Codex app-server exited ${code}: ${stderr}`));
  });
});

try {
  child.stdin.write(
    `${JSON.stringify({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "codex-wiki-protocol-check",
          title: "Codex Wiki Protocol Check",
          version: "0.2.0",
        },
        capabilities: { experimentalApi: false, requestAttestation: false },
      },
    })}\n`,
  );
  await initialized;
  child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
  child.kill("SIGTERM");

  const generator = spawn("npm", ["run", "protocol:generate", "--", output], { stdio: "inherit" });
  const code = await new Promise((resolvePromise, rejectPromise) => {
    generator.once("error", rejectPromise);
    generator.once("exit", resolvePromise);
  });
  if (code !== 0) throw new Error(`Protocol generator exited ${code}`);

  const clientRequests = readFileSync(join(output, "ClientRequest.ts"), "utf8");
  const serverRequests = readFileSync(join(output, "ServerRequest.ts"), "utf8");
  const notifications = readFileSync(join(output, "ServerNotification.ts"), "utf8");
  for (const method of ["initialize", "thread/start", "thread/resume", "turn/start"]) {
    if (!clientRequests.includes(`"method": "${method}"`))
      throw new Error(`Missing client method ${method}`);
  }
  for (const method of [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/tool/requestUserInput",
  ]) {
    if (!serverRequests.includes(`"method": "${method}"`))
      throw new Error(`Missing server request ${method}`);
  }
  for (const method of ["item/agentMessage/delta", "turn/completed"]) {
    if (!notifications.includes(`"method": "${method}"`))
      throw new Error(`Missing notification ${method}`);
  }
  console.log(`Codex ${version} app-server initialize and protocol checks passed.`);
} finally {
  lines.close();
  if (!child.killed) child.kill("SIGTERM");
  rmSync(output, { recursive: true, force: true });
}
