import {
  X509Certificate,
  createHash,
  createPrivateKey,
  randomUUID,
} from "node:crypto";

import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from "jose";

import { hashToken, randomToken } from "./crypto.js";
import type {
  EffectiveEntraConfig,
  MicrosoftClaims,
  OidcTransaction,
} from "./types.js";

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface TokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

function requireHttpsUrl(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`Entra discovery is missing ${name}`);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`Entra ${name} must use HTTPS`);
  return url.toString();
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export class MicrosoftOidcClient {
  constructor(private readonly fetchFn: typeof globalThis.fetch = globalThis.fetch) {}

  async discover(config: EffectiveEntraConfig): Promise<DiscoveryDocument> {
    const tenant = encodeURIComponent(config.tenantId);
    const discoveryUrl = new URL(
      `/${tenant}/v2.0/.well-known/openid-configuration`,
      config.authorityHost,
    );
    const response = await this.fetchFn(discoveryUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Entra discovery failed with HTTP ${response.status}`);
    const document = (await response.json()) as Record<string, unknown>;
    const expectedIssuer = `${new URL(config.authorityHost).origin}/${tenant}/v2.0`;
    if (document.issuer !== expectedIssuer) {
      throw new Error("Entra discovery issuer does not match the configured tenant");
    }
    return {
      issuer: expectedIssuer,
      authorization_endpoint: requireHttpsUrl(document.authorization_endpoint, "authorization_endpoint"),
      token_endpoint: requireHttpsUrl(document.token_endpoint, "token_endpoint"),
      jwks_uri: requireHttpsUrl(document.jwks_uri, "jwks_uri"),
    };
  }

  async authorizationRequest(input: {
    config: EffectiveEntraConfig;
    publicOrigin: URL;
    intent: "login" | "link";
    sessionUserId?: string;
  }): Promise<{ url: URL; transaction: OidcTransaction; state: string }> {
    const discovery = await this.discover(input.config);
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken(48);
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const redirectUri = new URL("/auth/microsoft/callback", input.publicOrigin).toString();
    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: input.config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return {
      url,
      state,
      transaction: {
        stateHash: hashToken(state),
        nonce,
        codeVerifier,
        intent: input.intent,
        ...(input.sessionUserId ? { sessionUserId: input.sessionUserId } : {}),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    };
  }

  private async clientAssertion(config: EffectiveEntraConfig, audience: string): Promise<string> {
    if (config.credential.type !== "certificate") throw new Error("Certificate credential required");
    const certificate = new X509Certificate(config.credential.certificatePem);
    const privateKey = createPrivateKey(config.credential.privateKeyPem);
    const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const key = await importPKCS8(pkcs8, "RS256");
    const now = Math.floor(Date.now() / 1000);
    const x5t = createHash("sha1").update(certificate.raw).digest("base64url");
    return new SignJWT({})
      .setProtectedHeader({ alg: "RS256", typ: "JWT", x5t })
      .setIssuer(config.clientId)
      .setSubject(config.clientId)
      .setAudience(audience)
      .setJti(randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(key);
  }

  async exchange(input: {
    config: EffectiveEntraConfig;
    publicOrigin: URL;
    transaction: OidcTransaction;
    code: string;
  }): Promise<MicrosoftClaims> {
    const discovery = await this.discover(input.config);
    const redirectUri = new URL("/auth/microsoft/callback", input.publicOrigin).toString();
    const parameters = new URLSearchParams({
      client_id: input.config.clientId,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: redirectUri,
      code_verifier: input.transaction.codeVerifier,
      scope: "openid profile email",
    });
    if (input.config.credential.type === "secret") {
      parameters.set("client_secret", input.config.credential.clientSecret);
    } else {
      parameters.set(
        "client_assertion_type",
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      );
      parameters.set(
        "client_assertion",
        await this.clientAssertion(input.config, discovery.token_endpoint),
      );
    }

    const tokenResponse = await this.fetchFn(discovery.token_endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: parameters,
      signal: AbortSignal.timeout(15_000),
    });
    const token = (await tokenResponse.json()) as TokenResponse;
    if (!tokenResponse.ok || !token.id_token) {
      throw new Error(
        `Entra token exchange failed: ${token.error_description ?? token.error ?? tokenResponse.status}`,
      );
    }

    const verified = await jwtVerify(
      token.id_token,
      createRemoteJWKSet(new URL(discovery.jwks_uri)),
      {
        issuer: discovery.issuer,
        audience: input.config.clientId,
        algorithms: ["RS256"],
      },
    );
    if (verified.payload.nonce !== input.transaction.nonce) {
      throw new Error("Entra ID token nonce mismatch");
    }
    const tenantId = stringClaim(verified.payload.tid);
    if (tenantId !== input.config.tenantId) throw new Error("Entra ID token tenant mismatch");
    const subject = stringClaim(verified.payload.sub);
    const objectId = stringClaim(verified.payload.oid);
    const username = stringClaim(verified.payload.preferred_username);
    const email = stringClaim(verified.payload.email) ?? username;
    if (!subject || !email) throw new Error("Entra ID token is missing subject or email claims");
    return {
      subject,
      tenantId,
      ...(objectId ? { objectId } : {}),
      email,
      displayName: stringClaim(verified.payload.name) ?? email,
      ...(username ? { username } : {}),
    };
  }
}
