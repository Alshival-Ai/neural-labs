import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createPublicKey, X509Certificate } from "node:crypto";
import { jwtVerify } from "jose";
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


it("signs certificate assertions using PS256 and the SHA-256 certificate thumbprint", async () => {
  const directory = mkdtempSync(join(tmpdir(), "entra-certificate-"));
  try {
    const keyPath = join(directory, "key.pem"), certPath = join(directory, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath,
      "-out", certPath, "-days", "1", "-subj", "/CN=fixture.invalid"], { stdio: "ignore" });
    const certificatePem = readFileSync(certPath, "utf8"), privateKeyPem = readFileSync(keyPath, "utf8");
    let assertion = "";
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (!init?.body) return Response.json(discovery());
      assertion = new URLSearchParams(String(init.body)).get("client_assertion")!;
      return Response.json({ access_token: "fixture", expires_in: 3600 });
    });
    await new MicrosoftOidcClient(transport as typeof fetch).applicationToken({ ...config,
      credential: { type: "certificate", certificatePem, privateKeyPem, thumbprint: "fixture", expiresAt: new Date(Date.now() + 86400000).toISOString() } }, "https://graph.microsoft.com/.default");
    const verified = await jwtVerify(assertion, createPublicKey(certificatePem), {
      algorithms: ["PS256"], issuer: config.clientId, audience: discovery().token_endpoint,
    });
    expect(verified.protectedHeader["x5t#S256"]).toBe(createHash("sha256").update(new X509Certificate(certificatePem).raw).digest("base64url"));
    expect(verified.protectedHeader).not.toHaveProperty("x5t");
    expect(verified.payload.sub).toBe(config.clientId);
    expect(verified.payload.exp! - verified.payload.iat!).toBe(300);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
