import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { AppConfig } from "../config.js";

type JsonRpcId = number | string;
type RpcMessage = { id?: JsonRpcId; method?: string; params?: any; result?: any; error?: { code: number; message: string; data?: unknown } };
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };
export type CodexEvent = { method: string; params: Record<string, unknown> };

export type RunTurnInput = {
  runId: string;
  cwd: string;
  codexThreadId: string | null;
  prompt: string;
  developerInstructions: string;
  onEvent: (event: CodexEvent) => void | Promise<void>;
  onApproval: (request: { method: string; params: Record<string, unknown> }) => Promise<"accept" | "decline">;
};

export type RunTurnResult = {
  threadId: string;
  turnId: string;
  status: "completed" | "interrupted" | "failed";
  error: { message?: string; codexErrorInfo?: string } | null;
  assistantText: string;
};

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<JsonRpcId, Pending>();
  private completion: Promise<RunTurnResult> | null = null;
  private resolveCompletion: ((result: RunTurnResult) => void) | null = null;
  private rejectCompletion: ((error: Error) => void) | null = null;
  private assistantText = "";
  private threadId = "";
  private turnId = "";

  constructor(private readonly config: AppConfig) {}

  private send(message: RpcMessage) {
    if (!this.child?.stdin.writable) throw new Error("Codex app-server is not running");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }

  private respond(id: JsonRpcId, result: unknown) {
    this.send({ id, result });
  }

  private async handleServerRequest(message: RpcMessage, onApproval: RunTurnInput["onApproval"]) {
    if (message.id === undefined || !message.method) return;
    if (message.method === "item/commandExecution/requestApproval" || message.method === "item/fileChange/requestApproval") {
      const decision = await onApproval({ method: message.method, params: message.params ?? {} });
      this.respond(message.id, { decision });
      return;
    }
    if (message.method === "item/tool/requestUserInput") {
      this.respond(message.id, { answers: {} });
      return;
    }
    if (message.method === "mcpServer/elicitation/request") {
      this.respond(message.id, { action: "decline" });
      return;
    }
    this.respond(message.id, { decision: "decline" });
  }

  private async handleMessage(message: RpcMessage, onEvent: RunTurnInput["onEvent"], onApproval: RunTurnInput["onApproval"]) {
    if (message.id !== undefined && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`Codex RPC ${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      await onEvent({ method: message.method, params: message.params ?? {} });
      await this.handleServerRequest(message, onApproval);
      return;
    }
    if (!message.method) return;
    const params = (message.params ?? {}) as Record<string, unknown>;
    if (message.method === "item/agentMessage/delta" && typeof params.delta === "string") this.assistantText += params.delta;
    if (message.method === "turn/completed") {
      const turn = params.turn as Record<string, any>;
      if (turn?.id === this.turnId) {
        this.resolveCompletion?.({ threadId: this.threadId, turnId: this.turnId, status: turn.status, error: turn.error ?? null, assistantText: this.assistantText });
      }
    }
    await onEvent({ method: message.method, params });
  }

  async runTurn(input: RunTurnInput): Promise<RunTurnResult> {
    const args = [
      "app-server", "--stdio",
      "-c", `model=${JSON.stringify(this.config.DEEPSEEK_MODEL)}`,
      "-c", 'model_provider="cwp_deepseek"',
      "-c", 'model_providers.cwp_deepseek.name="DeepSeek via CWP"',
      "-c", `model_providers.cwp_deepseek.base_url=${JSON.stringify(`http://127.0.0.1:${this.config.API_PORT}/internal/deepseek/v1`)}`,
      "-c", 'model_providers.cwp_deepseek.env_key="AGENT_PROXY_TOKEN"',
      "-c", 'model_providers.cwp_deepseek.wire_api="responses"',
      "-c", 'model_providers.cwp_deepseek.env_http_headers={ "X-CWP-Run-ID" = "CWP_RUN_ID" }',
      "-c", "model_context_window=1000000",
      "-c", 'model_reasoning_summary="none"',
      "-c", "analytics.enabled=false",
    ];
    this.child = spawn(this.config.CODEX_BIN, args, {
      cwd: input.cwd,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CODEX_HOME: this.config.CODEX_HOME,
        AGENT_PROXY_TOKEN: this.config.AGENT_PROXY_TOKEN,
        CWP_RUN_ID: input.runId,
        LANG: process.env.LANG ?? "en_US.UTF-8",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.completion = new Promise((resolve, reject) => { this.resolveCompletion = resolve; this.rejectCompletion = reject; });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      try { void this.handleMessage(JSON.parse(line) as RpcMessage, input.onEvent, input.onApproval); }
      catch (error) { this.rejectCompletion?.(error instanceof Error ? error : new Error("Invalid Codex message")); }
    });
    let stderr = "";
    this.child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000); });
    this.child.once("error", (error) => this.rejectCompletion?.(error));
    this.child.once("exit", (code) => {
      if (code && code !== 0) this.rejectCompletion?.(new Error(`Codex app-server exited ${code}: ${stderr}`));
    });

    try {
      await this.request("initialize", { clientInfo: { name: "codex-wiki-platform", title: "Codex Wiki Platform", version: "0.1.0" }, capabilities: { experimentalApi: false, requestAttestation: false } });
      this.send({ method: "initialized" });
      const common = {
        model: this.config.DEEPSEEK_MODEL,
        modelProvider: "cwp_deepseek",
        cwd: input.cwd,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        developerInstructions: input.developerInstructions,
      };
      const threadResponse = input.codexThreadId
        ? await this.request("thread/resume", { threadId: input.codexThreadId, ...common })
        : await this.request("thread/start", { ...common, ephemeral: false, serviceName: "Codex Wiki Platform" });
      this.threadId = threadResponse.thread.id;
      const turnResponse = await this.request("turn/start", {
        threadId: this.threadId,
        input: [{ type: "text", text: input.prompt, text_elements: [] }],
        cwd: input.cwd,
        approvalPolicy: "on-request",
      });
      this.turnId = turnResponse.turn.id;
      return await this.completion;
    } finally {
      this.close();
    }
  }

  close() {
    this.rejectCompletion?.(new Error("Codex app-server closed"));
    for (const pending of this.pending.values()) pending.reject(new Error("Codex app-server closed"));
    this.pending.clear();
    this.child?.kill("SIGTERM");
    this.child = null;
  }
}
