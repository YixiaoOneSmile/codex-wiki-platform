import { randomUUID } from "node:crypto";

type ResponsesInputItem = Record<string, unknown>;
type ChatMessage = Record<string, unknown>;
type ChatToolCall = { index: number; id?: string; type?: string; function?: { name?: string; arguments?: string } };
export type ToolCallAccumulator = { id: string; itemId: string; name: string; arguments: string; started: boolean };

export function mergeToolCallDelta(call: ToolCallAccumulator | undefined, delta: ChatToolCall): ToolCallAccumulator {
  const next = call ?? { id: delta.id ?? `call_${randomUUID().replaceAll("-", "")}`, itemId: `fc_${randomUUID().replaceAll("-", "")}`, name: "", arguments: "", started: false };
  if (delta.id) next.id = delta.id;
  if (delta.function?.name) next.name += delta.function.name;
  if (delta.function?.arguments) next.arguments += delta.function.arguments;
  return next;
}

export type ResponsesRequest = {
  model?: string;
  instructions?: string;
  input?: string | ResponsesInputItem[];
  tools?: Array<Record<string, unknown>>;
  stream?: boolean;
  parallel_tool_calls?: boolean;
};

export type AdapterUsage = {
  requestId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const value = part as Record<string, unknown>;
    return typeof value.text === "string" ? value.text : "";
  }).join("\n");
}

function toChatMessages(body: ResponsesRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (body.instructions) messages.push({ role: "system", content: body.instructions });
  if (typeof body.input === "string") messages.push({ role: "user", content: body.input });
  for (const item of Array.isArray(body.input) ? body.input : []) {
    if (item.type === "message") {
      const role = item.role === "developer" ? "system" : item.role;
      messages.push({ role, content: contentText(item.content) });
    } else if (item.type === "function_call") {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: item.call_id ?? item.id,
          type: "function",
          function: { name: item.name, arguments: item.arguments ?? "{}" },
        }],
      });
    } else if (item.type === "function_call_output") {
      messages.push({ role: "tool", tool_call_id: item.call_id, content: contentText(item.output) || String(item.output ?? "") });
    }
  }
  return messages;
}

function toChatTools(tools: ResponsesRequest["tools"]) {
  return (tools ?? []).flatMap((tool) => {
    if (tool.type !== "function" || typeof tool.name !== "string") return [];
    return [{ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters ?? { type: "object", properties: {} }, strict: tool.strict } }];
  });
}

async function* dataEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      yield JSON.parse(data) as Record<string, unknown>;
    }
    if (done) break;
  }
}

function baseResponse(id: string, model: string, createdAt: number) {
  return {
    id,
    object: "response",
    created_at: createdAt,
    status: "in_progress",
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model,
    output: [],
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: null,
    store: false,
    temperature: null,
    text: { format: { type: "text" } },
    tool_choice: "auto",
    tools: [],
    top_p: null,
    truncation: "disabled",
    usage: null,
    user: null,
    metadata: {},
  };
}

export async function streamDeepSeekAsResponses(input: {
  body: ResponsesRequest;
  apiKey: string;
  baseUrl: string;
  model: string;
  userId: string;
  write: (chunk: string) => void;
}): Promise<AdapterUsage> {
  const upstream = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({
      model: input.model,
      messages: toChatMessages(input.body),
      tools: toChatTools(input.body.tools),
      tool_choice: input.body.tools?.length ? "auto" : undefined,
      parallel_tool_calls: input.body.parallel_tool_calls ?? true,
      thinking: { type: "disabled" },
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 32768,
      user_id: input.userId,
    }),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!upstream.ok || !upstream.body) {
    const message = (await upstream.text()).slice(0, 1000);
    throw new Error(`DeepSeek upstream ${upstream.status}: ${message}`);
  }

  const responseId = `resp_${randomUUID().replaceAll("-", "")}`;
  const messageId = `msg_${randomUUID().replaceAll("-", "")}`;
  const createdAt = Math.floor(Date.now() / 1000);
  let sequence = 0;
  let textStarted = false;
  let text = "";
  const toolCalls = new Map<number, ToolCallAccumulator>();
  const usage: AdapterUsage = { requestId: null, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  const response = baseResponse(responseId, input.model, createdAt);
  const emit = (type: string, payload: Record<string, unknown>) => {
    input.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...payload })}\n\n`);
  };
  emit("response.created", { response });

  for await (const chunk of dataEvents(upstream.body)) {
    if (typeof chunk.id === "string") usage.requestId = chunk.id;
    const rawUsage = chunk.usage as Record<string, unknown> | undefined;
    if (rawUsage) {
      usage.inputTokens = Number(rawUsage.prompt_tokens ?? 0);
      usage.outputTokens = Number(rawUsage.completion_tokens ?? 0);
      const details = rawUsage.prompt_tokens_details as Record<string, unknown> | undefined;
      usage.cachedInputTokens = Number(details?.cached_tokens ?? rawUsage.prompt_cache_hit_tokens ?? 0);
    }
    const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
    const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
    if (!delta) continue;
    const deltaText = typeof delta.content === "string" ? delta.content : "";
    if (deltaText) {
      if (!textStarted) {
        textStarted = true;
        emit("response.output_item.added", { output_index: 0, item: { id: messageId, type: "message", status: "in_progress", role: "assistant", content: [] } });
        emit("response.content_part.added", { item_id: messageId, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [], logprobs: [] } });
      }
      text += deltaText;
      emit("response.output_text.delta", { item_id: messageId, output_index: 0, content_index: 0, delta: deltaText, logprobs: [] });
    }
    for (const toolDelta of (delta.tool_calls as ChatToolCall[] | undefined) ?? []) {
      const index = toolDelta.index;
      const previous = toolCalls.get(index);
      const call = mergeToolCallDelta(previous, toolDelta);
      toolCalls.set(index, call);
      if (!call.started && call.name) {
        call.started = true;
        emit("response.output_item.added", { output_index: textStarted ? index + 1 : index, item: { id: call.itemId, type: "function_call", status: "in_progress", call_id: call.id, name: call.name, arguments: "" } });
      }
      const args = toolDelta.function?.arguments ?? "";
      if (args) {
        emit("response.function_call_arguments.delta", { item_id: call.itemId, output_index: textStarted ? index + 1 : index, delta: args });
      }
    }
  }

  const output: Array<Record<string, unknown>> = [];
  if (textStarted) {
    const part = { type: "output_text", text, annotations: [], logprobs: [] };
    emit("response.output_text.done", { item_id: messageId, output_index: 0, content_index: 0, text, logprobs: [] });
    emit("response.content_part.done", { item_id: messageId, output_index: 0, content_index: 0, part });
    const item = { id: messageId, type: "message", status: "completed", role: "assistant", content: [part] };
    emit("response.output_item.done", { output_index: 0, item });
    output.push(item);
  }
  for (const [index, call] of [...toolCalls.entries()].sort(([a], [b]) => a - b)) {
    const outputIndex = textStarted ? index + 1 : index;
    emit("response.function_call_arguments.done", { item_id: call.itemId, output_index: outputIndex, arguments: call.arguments });
    const item = { id: call.itemId, type: "function_call", status: "completed", call_id: call.id, name: call.name, arguments: call.arguments };
    emit("response.output_item.done", { output_index: outputIndex, item });
    output.push(item);
  }
  const completed = {
    ...response,
    status: "completed",
    output,
    usage: {
      input_tokens: usage.inputTokens,
      input_tokens_details: { cached_tokens: usage.cachedInputTokens },
      output_tokens: usage.outputTokens,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: usage.inputTokens + usage.outputTokens,
    },
  };
  emit("response.completed", { response: completed });
  input.write("data: [DONE]\n\n");
  return usage;
}
