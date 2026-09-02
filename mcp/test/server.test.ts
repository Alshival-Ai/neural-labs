import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { createApplication } from "../src/server.js";

const config = loadConfig({
  AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
  AZURE_TENANT_ID: "00000000-0000-0000-0000-000000000002",
  MCP_PUBLIC_URL: "http://127.0.0.1:3000/mcp",
});

const authInfo: AuthInfo = {
  token: "test-token",
  clientId: config.azureClientId,
  scopes: [config.oauthScope],
  expiresAt: Math.floor(Date.now() / 1000) + 300,
  extra: {
    identity: {
      subject: "subject-id",
      objectId: "user-object-id",
      tenantId: config.azureTenantId,
      displayName: "Example User",
      username: "user@example.invalid",
    },
  },
};

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token) {
    if (token !== "test-token") throw new Error("invalid test token");
    return authInfo;
  },
};

function responseMessage(response: request.Response): Record<string, unknown> {
  if (response.type === "application/json") {
    return response.body as Record<string, unknown>;
  }
  const data = response.text
    .split("\n")
    .find((line) => line.startsWith("data:"))
    ?.slice("data:".length)
    .trim();
  if (!data) throw new Error("MCP response did not contain a JSON or SSE message");
  return JSON.parse(data) as Record<string, unknown>;
}

describe("MCP HTTP application", () => {
  it("serves health and RFC 9728 protected resource metadata publicly", async () => {
    const application = createApplication(config, verifier);

    await request(application.app).get("/healthz").expect(200, { status: "ok" });
    const metadata = await request(application.app)
      .get("/.well-known/oauth-protected-resource/mcp")
      .expect(200);

    expect(metadata.body).toMatchObject({
      resource: config.publicUrl.toString(),
      authorization_servers: [config.oauthIssuer],
      scopes_supported: [config.oauthScope],
    });
    await application.close();
  });

  it("challenges unauthenticated MCP requests with discoverable metadata", async () => {
    const application = createApplication(config, verifier);
    const response = await request(application.app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(401);

    expect(response.headers["www-authenticate"]).toContain(
      'resource_metadata="http://127.0.0.1:3000/.well-known/oauth-protected-resource/mcp"',
    );
    await application.close();
  });

  it("returns the validated Entra identity from whoami", async () => {
    const application = createApplication(config, verifier);
    const response = await request(application.app)
      .post("/mcp")
      .set("Authorization", "Bearer test-token")
      .set("Accept", "application/json, text/event-stream")
      .set("MCP-Protocol-Version", "2025-11-25")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "whoami", arguments: {} },
      })
      .expect(200);

    const message = responseMessage(response) as {
      result: { structuredContent: Record<string, unknown> };
    };
    expect(message.result.structuredContent).toMatchObject({
      objectId: "user-object-id",
      tenantId: config.azureTenantId,
      username: "user@example.invalid",
    });
    await application.close();
  });

  it("bridges Team Chat tools using the validated Entra identity", async () => {
    const teamConfig = loadConfig({
      AZURE_CLIENT_ID: config.azureClientId,
      AZURE_TENANT_ID: config.azureTenantId,
      MCP_PUBLIC_URL: "http://127.0.0.1:3000/mcp",
      MCP_TEAM_API_URL: "http://control-plane:4174/internal/mcp/team",
      MCP_CONFIG_TOKEN: "test-team-token-at-least-thirty-two-characters",
    });
    const calls: Array<[string | URL | Request, RequestInit | undefined]> = [];
    const fetchTeam = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push([input, init]);
      return new Response(JSON.stringify({ channels: [{ id: "channel-1", name: "General" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const application = createApplication(teamConfig, verifier, fetchTeam as typeof fetch);
    const response = await request(application.app)
      .post("/mcp")
      .set("Authorization", "Bearer test-token")
      .set("Accept", "application/json, text/event-stream")
      .set("MCP-Protocol-Version", "2025-11-25")
      .send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "list_team_channels", arguments: {} },
      })
      .expect(200);

    const message = responseMessage(response) as {
      result: { structuredContent: { channels: Array<{ name: string }> } };
    };
    expect(message.result.structuredContent.channels[0]?.name).toBe("General");
    expect(fetchTeam).toHaveBeenCalledOnce();
    const [url, options] = calls[0]!;
    expect(String(url)).toBe("http://control-plane:4174/internal/mcp/team/list-channels");
    expect(options?.headers).toMatchObject({
      Authorization: "Bearer test-team-token-at-least-thirty-two-characters",
    });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      identity: {
        subject: "subject-id",
        objectId: "user-object-id",
        tenantId: config.azureTenantId,
      },
    });
    await application.close();
  });
});
