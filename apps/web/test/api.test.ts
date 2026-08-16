import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";

afterEach(() => { vi.unstubAllGlobals(); });

describe("web API client", () => {
  it("does not declare JSON for a request without a body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await api("/api/auth/logout", { method: "POST" });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(request.headers).has("content-type")).toBe(false);
  });

  it("declares JSON when a body is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await api("/api/example", { method: "POST", body: JSON.stringify({ value: 1 }) });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(request.headers).get("content-type")).toBe("application/json");
  });
});
