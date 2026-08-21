import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { CodexAppServerClient } from "../src/services/codex-app-server.js";

describe("Codex app-server client", () => {
  it("runs a 0.149-compatible turn, handles approval, and fails closed for unsupported requests", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://unused",
      SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
      AGENT_PROXY_TOKEN: "test-agent-proxy-token-with-at-least-32-characters",
      CODEX_BIN: resolve("apps/api/test/fixtures/fake-codex.mjs"),
      CODEX_HOME: resolve("runtime/test-codex-home"),
      DATA_ROOT: resolve("runtime/test-orgs"),
    });
    const client = new CodexAppServerClient(config);
    const methods: string[] = [];
    const approvals: string[] = [];
    const result = await client.runTurn({
      runId: "run-test",
      cwd: process.cwd(),
      codexThreadId: null,
      prompt: "hello",
      developerInstructions: "test",
      onEvent: ({ method }) => {
        methods.push(method);
      },
      onApproval: async ({ method }) => {
        approvals.push(method);
        return "accept";
      },
    });

    expect(result).toMatchObject({
      threadId: "thread-test",
      turnId: "turn-test",
      status: "completed",
      assistantText: "测试完成",
    });
    expect(approvals).toEqual(["item/commandExecution/requestApproval"]);
    expect(methods).toContain("item/permissions/requestApproval");
    expect(methods).toContain("turn/completed");
  });
});
