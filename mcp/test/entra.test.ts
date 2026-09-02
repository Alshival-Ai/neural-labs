import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { EntraTokenVerifier } from "../src/entra.js";

const config = loadConfig({
  AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
  AZURE_TENANT_ID: "00000000-0000-0000-0000-000000000002",
  MCP_PUBLIC_URL: "https://mcp.example.com/mcp",
});

let privateKey: CryptoKey;
let verifier: EntraTokenVerifier;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey);
  publicJwk.kid = "test-key";
  verifier = new EntraTokenVerifier(
    config,
    createLocalJWKSet({ keys: [publicJwk] }),
  );
});

async function sign(overrides: JWTPayload = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tid: config.azureTenantId,
    ver: "2.0",
    scp: config.requiredScope,
    azp: config.azureClientId,
    oid: "user-object-id",
    name: "Example User",
    preferred_username: "user@example.invalid",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "JWT" })
    .setIssuer(config.azureIssuer)
    .setAudience(config.tokenAudience)
    .setSubject("subject-id")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

describe("EntraTokenVerifier", () => {
  it("accepts a valid delegated Entra v2 access token", async () => {
    const token = await sign();
    const auth = await verifier.verifyAccessToken(token);

    expect(auth.clientId).toBe(config.azureClientId);
    expect(auth.scopes).toContain(config.oauthScope);
    expect(auth.extra?.identity).toEqual({
      subject: "subject-id",
      objectId: "user-object-id",
      tenantId: config.azureTenantId,
      displayName: "Example User",
      username: "user@example.invalid",
    });
  });

  it.each([
    ["wrong tenant", { tid: "wrong-tenant" }],
    ["wrong token version", { ver: "1.0" }],
    ["missing delegated scope", { scp: "other.scope" }],
    ["wrong authorized client", { azp: "another-client" }],
  ])("rejects %s", async (_case, claims) => {
    await expect(verifier.verifyAccessToken(await sign(claims))).rejects.toMatchObject({
      code: "invalid_token",
    });
  });

  it("rejects a token for another audience", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      tid: config.azureTenantId,
      ver: "2.0",
      scp: config.requiredScope,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(config.azureIssuer)
      .setAudience("another-api")
      .setSubject("subject-id")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);

    await expect(verifier.verifyAccessToken(token)).rejects.toMatchObject({
      code: "invalid_token",
    });
  });
});
