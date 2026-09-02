import express, { type Express, type NextFunction, type Request, type Response } from "express";

import type { McpConfig } from "./config.js";

type Fetch = typeof globalThis.fetch;

const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

function value(input: unknown): string | undefined {
  return typeof input === "string" && input.length > 0 ? input : undefined;
}

function invalidRequest(response: Response, description: string): void {
  response.status(400).json({
    error: "invalid_request",
    error_description: description,
  });
}

function allowedScopes(config: McpConfig): Set<string> {
  return new Set([
    config.oauthScope,
    "openid",
    "profile",
    "email",
    "offline_access",
  ]);
}

function validateScopes(config: McpConfig, rawScope: string | undefined): string[] | undefined {
  if (!rawScope) return undefined;
  const scopes = [...new Set(rawScope.split(/\s+/).filter(Boolean))];
  const allowed = allowedScopes(config);
  if (!scopes.includes(config.oauthScope) || scopes.some((scope) => !allowed.has(scope))) {
    return undefined;
  }
  return scopes;
}

function validCodexRedirect(rawRedirect: string | undefined): rawRedirect is string {
  if (!rawRedirect) return false;
  try {
    const redirect = new URL(rawRedirect);
    return (
      redirect.protocol === "http:" &&
      redirect.hostname === "127.0.0.1" &&
      redirect.username === "" &&
      redirect.password === "" &&
      (redirect.pathname === "/callback" || redirect.pathname.startsWith("/callback/")) &&
      redirect.search === "" &&
      redirect.hash === ""
    );
  } catch {
    return false;
  }
}

function validateResource(config: McpConfig, resource: string | undefined): boolean {
  return resource === undefined || resource === config.publicUrl.toString();
}

export function mountEntraOAuthProxy(
  app: Express,
  config: McpConfig,
  fetchFn: Fetch = globalThis.fetch,
): void {
  app.get("/oauth/authorize", (request: Request, response: Response) => {
    const clientId = value(request.query.client_id);
    const redirectUri = value(request.query.redirect_uri);
    const responseType = value(request.query.response_type);
    const responseMode = value(request.query.response_mode);
    const state = value(request.query.state);
    const codeChallenge = value(request.query.code_challenge);
    const codeChallengeMethod = value(request.query.code_challenge_method);
    const resource = value(request.query.resource);
    const scopes = validateScopes(config, value(request.query.scope));

    if (clientId !== config.azureClientId) {
      return invalidRequest(response, "Unknown OAuth client");
    }
    if (!validCodexRedirect(redirectUri)) {
      return invalidRequest(response, "Invalid Codex loopback redirect URI");
    }
    if (responseType !== "code" || (responseMode && responseMode !== "query")) {
      return invalidRequest(response, "Only the authorization code response is supported");
    }
    if (!state) {
      return invalidRequest(response, "OAuth state is required");
    }
    if (codeChallengeMethod !== "S256" || !codeChallenge || !CODE_CHALLENGE_PATTERN.test(codeChallenge)) {
      return invalidRequest(response, "PKCE with an S256 code challenge is required");
    }
    if (!scopes) {
      return invalidRequest(response, "The requested OAuth scopes are not allowed");
    }
    if (!validateResource(config, resource)) {
      return invalidRequest(response, "The OAuth resource does not match this MCP server");
    }

    const destination = new URL(config.azureAuthorizationUrl);
    const forwarded: Record<string, string> = {
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      scope: scopes.join(" "),
    };
    for (const optional of ["prompt", "login_hint", "domain_hint", "claims", "nonce", "id_token_hint"]) {
      const optionalValue = value(request.query[optional]);
      if (optionalValue) forwarded[optional] = optionalValue;
    }
    for (const [name, forwardedValue] of Object.entries(forwarded)) {
      destination.searchParams.set(name, forwardedValue);
    }
    response.redirect(302, destination.toString());
  });

  app.post(
    "/oauth/token",
    express.urlencoded({ extended: false, limit: "16kb" }),
    (request: Request, response: Response, next: NextFunction) => {
      void (async () => {
        if (request.headers.authorization || request.body.client_secret || request.body.client_assertion) {
          return invalidRequest(response, "This public OAuth client must not authenticate with a secret");
        }

        const grantType = value(request.body.grant_type);
        const clientId = value(request.body.client_id);
        const resource = value(request.body.resource);
        const scopes = request.body.scope
          ? validateScopes(config, value(request.body.scope))
          : undefined;
        if (clientId !== config.azureClientId) {
          return invalidRequest(response, "Unknown OAuth client");
        }
        if (!validateResource(config, resource)) {
          return invalidRequest(response, "The OAuth resource does not match this MCP server");
        }
        if (request.body.scope && !scopes) {
          return invalidRequest(response, "The requested OAuth scopes are not allowed");
        }

        const upstreamBody = new URLSearchParams({
          grant_type: grantType ?? "",
          client_id: clientId,
        });
        if (grantType === "authorization_code") {
          const code = value(request.body.code);
          const redirectUri = value(request.body.redirect_uri);
          const codeVerifier = value(request.body.code_verifier);
          if (
            !code ||
            !validCodexRedirect(redirectUri) ||
            !codeVerifier ||
            !CODE_VERIFIER_PATTERN.test(codeVerifier)
          ) {
            return invalidRequest(response, "Authorization code, loopback redirect, and PKCE verifier are required");
          }
          upstreamBody.set("code", code);
          upstreamBody.set("redirect_uri", redirectUri);
          upstreamBody.set("code_verifier", codeVerifier);
        } else if (grantType === "refresh_token") {
          const refreshToken = value(request.body.refresh_token);
          if (!refreshToken) {
            return invalidRequest(response, "Refresh token is required");
          }
          upstreamBody.set("refresh_token", refreshToken);
        } else {
          return invalidRequest(response, "Unsupported OAuth grant type");
        }
        if (scopes) upstreamBody.set("scope", scopes.join(" "));

        const upstream = await fetchFn(config.azureTokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: upstreamBody,
          signal: AbortSignal.timeout(15_000),
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        response.status(upstream.status);
        response.set("Cache-Control", "no-store");
        response.set("Pragma", "no-cache");
        response.type(upstream.headers.get("content-type") || "application/json");
        response.send(body);
      })().catch(next);
    },
  );
}
