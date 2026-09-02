import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { fetchRuntimeConfig, loadRuntimeConfigSource } from "../src/runtimeConfig.js";

describe("managed runtime configuration", () => {
  it("loads its bearer token from a file and validates the interval", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "neural-labs-mcp-"));
    const tokenFile = path.join(directory, "token");
    await writeFile(tokenFile, "a".repeat(48));
    const source = await loadRuntimeConfigSource({
      MCP_CONTROL_PLANE_CONFIG_URL: "http://control-plane:4174/internal/mcp/config",
      MCP_CONFIG_TOKEN_FILE: tokenFile,
      MCP_CONFIG_POLL_INTERVAL_MS: "5000",
    });
    expect(source?.token).toHaveLength(48);
    expect(source?.url.hostname).toBe("control-plane");
    expect(source?.pollIntervalMs).toBe(5000);
  });

  it("loads its bearer token directly from a protected environment", async () => {
    const source = await loadRuntimeConfigSource({
      MCP_CONTROL_PLANE_CONFIG_URL: "http://control-plane:4174/internal/mcp/config",
      MCP_CONFIG_TOKEN: "a".repeat(48),
    });
    expect(source?.token).toHaveLength(48);
    expect(source?.url.hostname).toBe("control-plane");
  });

  it("maps public control-plane values into an MCP config without credentials", async () => {
    const fetchFn = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          version: 7,
          tenantId: "tenant-id",
          clientId: "client-id",
          authorityHost: "https://login.microsoftonline.com",
          publicUrl: "https://neural-labs.example/mcp",
          oauthScope: "api://client-id/mcp.access",
          requiredScope: "mcp.access",
          tokenAudience: "client-id",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await fetchRuntimeConfig(
      {
        url: new URL("http://control-plane:4174/internal/mcp/config"),
        token: "a".repeat(48),
        pollIntervalMs: 5000,
      },
      { MCP_HOST: "0.0.0.0", MCP_PORT: "3000" },
      fetchFn as typeof fetch,
    );
    expect(result.state).toBe("configured");
    if (result.state === "configured") {
      expect(result.version).toBe(7);
      expect(result.config.azureTenantId).toBe("tenant-id");
      expect(result.config.publicUrl.toString()).toBe("https://neural-labs.example/mcp");
    }
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({ authorization: `Bearer ${"a".repeat(48)}` }),
    );
  });

  it("treats an intentional 503 response as disabled", async () => {
    const result = await fetchRuntimeConfig(
      {
        url: new URL("http://control-plane:4174/internal/mcp/config"),
        token: "a".repeat(48),
        pollIntervalMs: 5000,
      },
      {},
      async () =>
        new Response(JSON.stringify({ status: "unconfigured", version: 3 }), { status: 503 }),
    );
    expect(result).toEqual({ state: "unconfigured", version: 3 });
  });
});
