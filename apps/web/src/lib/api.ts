export class ApiClientError extends Error {
  constructor(public code: string, message: string, public correlationId?: string) { super(message); }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiClientError(body.error?.code ?? "REQUEST_FAILED", body.error?.message ?? "请求失败", body.error?.correlationId);
  }
  return body as T;
}

export type Me = {
  user: { id: string; email: string; displayName: string; isSuperAdmin: boolean; mustChangePassword: boolean };
  activeOrgId: string;
  organizations: Array<{
    id: string; slug: string; displayName: string; logoUrl: string | null; accentColor: string;
    role: "owner" | "admin" | "member"; teamWikiRole: "editor" | "user"; personalWikiEnabled: boolean;
  }>;
};

export type Conversation = { id: string; title: string; createdAt: string; updatedAt: string };
export type WikiSource = { id: string; scope: "team" | "personal"; path: string; title: string; excerpt: string };
export type WikiSearchTrace = { searchedPageCount: number; sources: WikiSource[] };
export type ScheduledTaskSummary = { id: string; title: string; url: string; scheduledFor: string; status: "scheduled" | "running" | "paused" | "completed" | "failed" | "cancelled"; recurrenceType: "once" | "daily" | "weekly" | "monthly" | "interval"; recurrenceConfig: { intervalMinutes?: number; weekdays?: number[]; dayOfMonth?: number }; timezone: string; runCount: number };
export type Message = { id: string; role: "user" | "assistant" | "system" | "tool"; content: string; metadata?: { wikiSearch?: WikiSearchTrace; scheduledTask?: ScheduledTaskSummary }; createdAt: string };

export async function streamMessage(input: {
  conversationId: string;
  content: string;
  onEvent: (event: string, data: any) => void;
}): Promise<void> {
  const response = await fetch(`/api/conversations/${input.conversationId}/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: input.content }),
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new ApiClientError(body.error?.code ?? "REQUEST_FAILED", body.error?.message ?? "发送失败", body.error?.correlationId);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      let data = "";
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) input.onEvent(event, JSON.parse(data));
      event = "message";
    }
    if (done) break;
  }
}

export async function uploadWikiFile(scope: "team" | "personal", file: File): Promise<void> {
  const data = new FormData(); data.append("file", file);
  const response = await fetch(`/api/wiki/${scope}/import`, { method: "POST", credentials: "include", body: data });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new ApiClientError(body.error?.code ?? "UPLOAD_FAILED", body.error?.message ?? "导入失败", body.error?.correlationId); }
}
