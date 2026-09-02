import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const baseEnv: NodeJS.ProcessEnv = {
  AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
  AZURE_TENANT_ID: "00000000-0000-0000-0000-000000000002",
  MCP_PUBLIC_URL: "https://mcp.example.com/mcp",
};

describe("loadConfig", () => {
  it("derives Entra endpoints and least-privilege scope defaults", () => {
    const config = loadConfig(baseEnv);

    expect(config.azureIssuer).toBe(
      "https://login.microsoftonline.com/00000000-0000-0000-0000-000000000002/v2.0",
    );
    expect(config.azureJwksUrl.toString()).toBe(
      "https://login.microsoftonline.com/00000000-0000-0000-0000-000000000002/discovery/v2.0/keys",
    );
    expect(config.oauthScope).toBe(
      "api://00000000-0000-0000-0000-000000000001/mcp.access",
    );
    expect(config.requiredScope).toBe("mcp.access");
    expect(config.tokenAudience).toBe(baseEnv.AZURE_CLIENT_ID);
    expect(config.oauthIssuer).toBe("https://mcp.example.com");
    expect(config.oauthAuthorizationUrl.toString()).toBe(
      "https://mcp.example.com/oauth/authorize",
    );
    expect(config.allowedHosts).toContain("mcp.example.com");
  });

  it("allows HTTP only on a loopback development URL", () => {
    expect(
      loadConfig({ ...baseEnv, MCP_PUBLIC_URL: "http://127.0.0.1:3000/mcp" })
        .publicUrl.toString(),
    ).toBe("http://127.0.0.1:3000/mcp");

    expect(() =>
      loadConfig({ ...baseEnv, MCP_PUBLIC_URL: "http://mcp.example.com/mcp" }),
    ).toThrow("must use HTTPS");
  });

  it("requires the tenant, client, and public endpoint", () => {
    expect(() => loadConfig({ ...baseEnv, AZURE_TENANT_ID: "" })).toThrow(
      "AZURE_TENANT_ID is required",
    );
    expect(() => loadConfig({ ...baseEnv, AZURE_CLIENT_ID: "" })).toThrow(
      "AZURE_CLIENT_ID is required",
    );
    expect(() => loadConfig({ ...baseEnv, MCP_PUBLIC_URL: "" })).toThrow(
      "MCP_PUBLIC_URL is required",
    );
  });

  it("requires an internal token whenever Team Chat tools are enabled", () => {
    expect(() => loadConfig({
      ...baseEnv,
      MCP_TEAM_API_URL: "http://control-plane:4174/internal/mcp/team",
    })).toThrow("MCP_TEAM_API_URL and MCP_CONFIG_TOKEN");

    const configured = loadConfig({
      ...baseEnv,
      MCP_TEAM_API_URL: "http://control-plane:4174/internal/mcp/team",
      MCP_CONFIG_TOKEN: "test-team-token-at-least-thirty-two-characters",
    });
    expect(configured.teamApi?.url.toString()).toBe("http://control-plane:4174/internal/mcp/team");
  });
});
