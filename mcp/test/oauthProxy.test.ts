import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { createApplication } from "../src/server.js";

const config = loadConfig({
  AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
  AZURE_TENANT_ID: "00000000-0000-0000-0000-000000000002",
  MCP_PUBLIC_URL: "https://mcp.example.com/mcp",
  MCP_ALLOWED_HOSTS: "mcp.example.com,127.0.0.1",
});

const unusedVerifier: OAuthTokenVerifier = {
  async verifyAccessToken(): Promise<AuthInfo> {
    throw new Error("not used by OAuth proxy tests");
  },
};

function authorizationQuery(): Record<string, string> {
  return {
    client_id: config.azureClientId,
    redirect_uri: "http://127.0.0.1:43123/callback/codex-test",
    response_type: "code",
    response_mode: "query",
    state: "opaque-state",
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
    scope: `${config.oauthScope} openid profile email offline_access`,
    resource: config.publicUrl.toString(),
  };
}

describe("Entra OAuth facade", () => {
  it("validates Codex PKCE parameters and redirects to the tenant authorization endpoint", async () => {
    const application = createApplication(config, unusedVerifier);
    const response = await request(application.app)
      .get("/oauth/authorize")
      .query(authorizationQuery())
      .expect(302);

    const destination = new URL(response.headers.location as string);
    expect(destination.origin).toBe(config.azureAuthorityHost.origin);
    expect(destination.pathname).toBe(config.azureAuthorizationUrl.pathname);
    expect(destination.searchParams.get("client_id")).toBe(config.azureClientId);
    expect(destination.searchParams.get("code_challenge_method")).toBe("S256");
    expect(destination.searchParams.has("resource")).toBe(false);
    await application.close();
  });

  it("rejects an unknown client and unapproved scopes", async () => {
    const application = createApplication(config, unusedVerifier);

    await request(application.app)
      .get("/oauth/authorize")
      .query({ ...authorizationQuery(), client_id: "unknown" })
      .expect(400, {
        error: "invalid_request",
        error_description: "Unknown OAuth client",
      });
    await request(application.app)
      .get("/oauth/authorize")
      .query({ ...authorizationQuery(), scope: `${config.oauthScope} User.Read` })
      .expect(400);
    await application.close();
  });

  it("forwards a public-client authorization-code exchange without secrets", async () => {
    let forwardedBody = "";
    const fetchFn = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      forwardedBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          access_token: "entra-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: config.requiredScope,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof globalThis.fetch;
    const application = createApplication(config, unusedVerifier, fetchFn);

    const response = await request(application.app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: config.azureClientId,
        code: "authorization-code",
        redirect_uri: "http://127.0.0.1:43123/callback/codex-test",
        code_verifier: "v".repeat(64),
        scope: config.oauthScope,
        resource: config.publicUrl.toString(),
      })
      .expect(200);

    expect(response.body.access_token).toBe("entra-access-token");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(fetchFn).toHaveBeenCalledOnce();
    const forwarded = new URLSearchParams(forwardedBody);
    expect(forwarded.get("code_verifier")).toBe("v".repeat(64));
    expect(forwarded.has("client_secret")).toBe(false);
    expect(forwarded.has("resource")).toBe(false);
    await application.close();
  });
});
