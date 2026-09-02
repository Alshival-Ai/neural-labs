import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

import type { McpConfig } from "./config.js";

export interface EntraIdentity {
  subject: string;
  objectId?: string;
  tenantId: string;
  displayName?: string;
  username?: string;
  email?: string;
}

function stringClaim(payload: JWTPayload, name: string): string | undefined {
  const value = payload[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function invalidToken(message = "The access token is invalid"): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidToken, message);
}

export class EntraTokenVerifier implements OAuthTokenVerifier {
  readonly #config: McpConfig;
  readonly #keySet: JWTVerifyGetKey;

  constructor(
    config: McpConfig,
    keySet: JWTVerifyGetKey = createRemoteJWKSet(config.azureJwksUrl),
  ) {
    this.#config = config;
    this.#keySet = keySet;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const { payload } = await jwtVerify(token, this.#keySet, {
        algorithms: ["RS256"],
        audience: this.#config.tokenAudience,
        issuer: this.#config.azureIssuer,
        requiredClaims: ["aud", "exp", "iss", "sub", "tid", "ver"],
      });

      if (payload.ver !== "2.0") {
        throw invalidToken("Only Microsoft Entra v2 access tokens are accepted");
      }
      if (payload.tid !== this.#config.azureTenantId) {
        throw invalidToken("The access token was issued by the wrong tenant");
      }

      const rawScopes = stringClaim(payload, "scp")?.split(/\s+/).filter(Boolean) ?? [];
      if (!rawScopes.includes(this.#config.requiredScope)) {
        throw invalidToken("The access token is missing the required delegated scope");
      }

      const subject = stringClaim(payload, "sub");
      const clientId = stringClaim(payload, "azp");
      if (!clientId || !subject || payload.exp === undefined) {
        throw invalidToken();
      }
      if (clientId !== this.#config.azureClientId) {
        throw invalidToken("The access token was issued to the wrong client");
      }

      const objectId = stringClaim(payload, "oid");
      const displayName = stringClaim(payload, "name");
      const username = stringClaim(payload, "preferred_username");
      const email = stringClaim(payload, "email");
      const identity: EntraIdentity = {
        subject,
        tenantId: this.#config.azureTenantId,
        ...(objectId ? { objectId } : {}),
        ...(displayName ? { displayName } : {}),
        ...(username ? { username } : {}),
        ...(email ? { email } : {}),
      };

      return {
        token,
        clientId,
        scopes: [...new Set([...rawScopes, this.#config.oauthScope])],
        expiresAt: payload.exp,
        extra: { identity },
      };
    } catch (error) {
      if (OAuthError.isInstance(error)) {
        throw error;
      }
      throw invalidToken();
    }
  }
}

export function identityFromAuth(authInfo: AuthInfo | undefined): EntraIdentity {
  const identity = authInfo?.extra?.identity;
  if (!identity || typeof identity !== "object") {
    throw new Error("Authenticated Entra identity is unavailable");
  }
  return identity as EntraIdentity;
}
