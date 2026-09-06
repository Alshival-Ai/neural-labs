import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { ProviderRuntime } from "../src/providerRuntime.js";
import { createProviderApplication } from "../src/providerServer.js";
import type { ProviderConfig } from "../src/providerConfig.js";
const base: ProviderConfig = { googleApiKey: "environment-google", klipyApiKey: "environment-klipy", pexelsApiKey: "environment-pexels", projectsRoot: "/tmp", downloadSigningKey: Buffer.alloc(32) };
const state = (revision = 1, mode = "settings", apiKey = "saved-key") => ({ providers: Object.fromEntries(["google-maps", "klipy", "pexels"].map((id) => [id, { revision, mode, ...(mode === "settings" ? { apiKey } : {}) }])) });
const endpoint = "http://control-plane:4174/internal/plugins/providers/config";

describe("leased provider configuration", () => {
  it("fails closed at startup, applies rotation, suppresses environment fallback, and expires its lease", async () => {
    let now = 0;
    const fetchFn = vi.fn<typeof fetch>();
    const runtime = new ProviderRuntime(base, endpoint, "placeholder-control-token", fetchFn, () => now);
    expect(runtime.snapshot().klipyApiKey).toBeUndefined();
    fetchFn.mockResolvedValueOnce(Response.json(state()));
    await runtime.refresh();
    expect(runtime.snapshot().klipyApiKey).toBe("saved-key");
    const before = runtime.snapshot();
    fetchFn.mockResolvedValueOnce(Response.json(state(2, "settings", "rotated-key")));
    await runtime.refresh();
    expect(runtime.snapshot().klipyApiKey).toBe("rotated-key");
    expect(before.klipyApiKey).toBe("saved-key");
    fetchFn.mockRejectedValueOnce(new Error("unavailable"));
    await runtime.refresh(); now = 59999;
    expect(runtime.status().klipy.available).toBe(true);
    now = 60000;
    expect(runtime.snapshot().klipyApiKey).toBeUndefined();
    expect(runtime.status().klipy.revision).toBeNull();
    fetchFn.mockResolvedValueOnce(Response.json(state(3, "disabled")));
    await runtime.refresh();
    expect(runtime.snapshot().klipyApiKey).toBeUndefined();
    expect(runtime.status().klipy).toMatchObject({ revision: 3, configured: false, available: true });
    fetchFn.mockResolvedValueOnce(Response.json(state(4, "inherit")));
    await runtime.refresh();
    expect(runtime.snapshot().klipyApiKey).toBe("environment-klipy");
    expect(JSON.stringify(runtime.status())).not.toContain("environment-klipy");
    expect(fetchFn.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("clears GIF selections on rotation or disconnect and applies the new key to search", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(state()));
    const runtime = new ProviderRuntime(base, endpoint, "placeholder-control-token", fetchFn);
    await runtime.refresh();
    const clear = vi.fn();
    const gifs = runtime.gifProvider(clear);
    expect(gifs.configured).toBe(true);
    const firstRevision = gifs.revision;
    fetchFn.mockResolvedValueOnce(Response.json(state(2, "settings", "new-klipy-key")));
    await runtime.refresh();
    fetchFn.mockResolvedValueOnce(Response.json({ results: [] }));
    await gifs.catalog("wave");
    expect(clear).toHaveBeenCalledTimes(2);
    expect(gifs.revision).not.toBe(firstRevision);
    const url = new URL(String(fetchFn.mock.calls.at(-1)?.[0]));
    expect(url.searchParams.get("key")).toBe("new-klipy-key");
    expect(url.searchParams.get("contentfilter")).toBe("off");
    fetchFn.mockResolvedValueOnce(Response.json(state(3, "disabled")));
    await runtime.refresh();
    expect(gifs.configured).toBe(false);
    expect(clear).toHaveBeenCalledTimes(3);
  });

  it("serves current MCP tool inventory and keys without rebuilding the server", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(state(1, "disabled")));
    const runtime = new ProviderRuntime(base, endpoint, "placeholder-control-token", fetchFn);
    await runtime.refresh();
    const application = createProviderApplication(() => runtime.snapshot(), fetchFn, () => runtime.status());
    const rpc = (method: string, params: object = {}) => request(application.app).post("/mcp").set("Host", "127.0.0.1").set("Accept", "application/json, text/event-stream").send({ jsonrpc: "2.0", id: 1, method, params });
    try {
      expect((await rpc("tools/list")).text).not.toContain("search_gif");
      fetchFn.mockResolvedValueOnce(Response.json(state(2)));
      await runtime.refresh();
      expect((await rpc("tools/list")).text).toContain("search_gif");
      fetchFn.mockResolvedValueOnce(Response.json({ results: [] }));
      const result = await rpc("tools/call", { name: "search_gif", arguments: { query: "wave" } });
      expect(result.status).toBe(200);
      expect(new URL(String(fetchFn.mock.calls.at(-1)?.[0])).searchParams.get("key")).toBe("saved-key");
      const health = await request(application.app).get("/healthz").set("Host", "127.0.0.1");
      expect(health.body.providerConfiguration.klipy.revision).toBe(2);
      expect(health.text).not.toContain("saved-key");
    } finally { await application.close(); }
  });

  it("reports individual Google capabilities and hides provider errors and credentials", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(state()));
    const runtime = new ProviderRuntime(base, endpoint, "placeholder-control-token", fetchFn);
    await runtime.refresh();
    fetchFn.mockResolvedValueOnce(Response.json(state())).mockResolvedValueOnce(Response.json({ places: [] })).mockResolvedValueOnce(Response.json({ status: "REQUEST_DENIED", error_message: "saved-key is invalid" }));
    const checked = await runtime.check("google-maps", 1);
    expect(checked.capabilities.map((item) => item.ok)).toEqual([true, false]);
    expect(JSON.stringify(checked)).not.toContain("saved-key");
    fetchFn.mockResolvedValueOnce(Response.json(state(2)));
    await expect(runtime.check("google-maps", 1)).rejects.toThrow("not been applied");
  });

  it("ignores malformed, oversized, and overlapping refreshes", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ providers: {} }));
    const runtime = new ProviderRuntime(base, endpoint, "placeholder-control-token", fetchFn);
    await runtime.refresh();
    expect(runtime.status().klipy.available).toBe(false);
    fetchFn.mockResolvedValueOnce(new Response("x".repeat(132000)));
    await Promise.all([runtime.refresh(), runtime.refresh()]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(runtime.snapshot().pexelsApiKey).toBeUndefined();
  });
});
