import { describe, expect, it, vi } from "vitest";

import { MicrosoftOidcClient } from "../src/entra.js";
import type { EffectiveEntraConfig } from "../src/types.js";

const config: EffectiveEntraConfig = {
  source: "onboarding",
  tenantId: "11111111-1111-1111-1111-111111111111",
  clientId: "00000000-0000-0000-0000-000000000000",
  authorityHost: "https://login.microsoftonline.com",
  credential: { type: "secret", clientSecret: "secret" },
};

function discovery() {
  return {
    issuer: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
    authorization_endpoint: `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`,
    token_endpoint: `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
    jwks_uri: `https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`,
  };
}

describe("Microsoft OIDC authorization", () => {
  it("creates a tenant-bound authorization request with PKCE", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify(discovery()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new MicrosoftOidcClient(fetchFn as typeof fetch);
    const result = await client.authorizationRequest({
      config,
      publicOrigin: new URL("https://neural-labs.example.com"),
      intent: "login",
    });

    expect(result.url.searchParams.get("response_type")).toBe("code");
    expect(result.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(result.url.searchParams.get("redirect_uri")).toBe(
      "https://neural-labs.example.com/auth/microsoft/callback",
    );
    expect(result.transaction.codeVerifier).not.toBe("");
    expect(result.transaction.stateHash).not.toBe(result.state);
  });

  it("rejects discovery from another issuer", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ...discovery(), issuer: "https://issuer.invalid/v2.0" }), {
        status: 200,
      }),
    );
    await expect(new MicrosoftOidcClient(fetchFn as typeof fetch).discover(config)).rejects.toThrow(
      /issuer/,
    );
  });
});
