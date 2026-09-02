import { afterEach, describe, expect, it, vi } from "vitest";

import { teamChatApi, teamSocketUrl } from "./teamChat";

afterEach(() => vi.unstubAllGlobals());

describe("Team Chat browser transport", () => {
  it("uses a same-origin WebSocket URL with the one-use ticket", () => {
    const url = new URL(teamSocketUrl("opaque-ticket"));
    expect(url.protocol).toBe(window.location.protocol === "https:" ? "wss:" : "ws:");
    expect(url.host).toBe(window.location.host);
    expect(url.pathname).toBe("/api/team/socket");
    expect(url.searchParams.get("ticket")).toBe("opaque-ticket");
  });

  it("protects channel mutations with the session CSRF token", async () => {
    const calls: Array<[string | URL | Request, RequestInit | undefined]> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push([input, init]);
      return new Response(JSON.stringify({
        channel: { id: "11111111-1111-4111-8111-111111111111", name: "General" },
        messages: [],
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await teamChatApi.create("csrf-token", {
      name: "General",
      audience: "everyone",
      memberIds: [],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = calls[0]!;
    if (!init) throw new Error("Team Chat mutation did not include request options");
    expect(url).toBe("/api/team/channels");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "General",
      audience: "everyone",
      memberIds: [],
    });
  });
});
