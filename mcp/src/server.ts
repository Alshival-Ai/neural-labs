import { randomUUID } from "node:crypto";

import {
  createMcpHandler,
  McpServer,
  type AuthInfo,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import {
  createMcpExpressApp,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
  requireBearerAuth,
} from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";

import type { McpConfig } from "./config.js";
import { EntraTokenVerifier, identityFromAuth, type EntraIdentity } from "./entra.js";
import { mountEntraOAuthProxy } from "./oauthProxy.js";

export interface McpApplication {
  app: Express;
  close(): Promise<void>;
}

export function buildOAuthMetadata(config: McpConfig): OAuthMetadata {
  return {
    issuer: config.oauthIssuer,
    authorization_endpoint: config.oauthAuthorizationUrl.toString(),
    token_endpoint: config.oauthTokenUrl.toString(),
    response_types_supported: ["code"],
    response_modes_supported: ["query", "form_post"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [
      config.oauthScope,
      "openid",
      "profile",
      "email",
      "offline_access",
    ],
    authorization_response_iss_parameter_supported: false,
  };
}

async function teamRequest(
  config: McpConfig,
  identity: EntraIdentity,
  operation: string,
  input: Record<string, unknown>,
  fetchFn: typeof globalThis.fetch,
): Promise<Record<string, unknown>> {
  if (!config.teamApi) throw new Error("Neural Labs Team Chat tools are not configured");
  const url = new URL(config.teamApi.url);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${operation}`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.teamApi.token}`,
    },
    body: JSON.stringify({ identity, ...input }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (!response.ok) {
    const nested = payload?.error as { message?: unknown } | undefined;
    throw new Error(typeof nested?.message === "string" ? nested.message : `Team Chat request failed with HTTP ${response.status}`);
  }
  return payload ?? {};
}

function mcpValue(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function buildMcpServer(authInfo: AuthInfo | undefined, config: McpConfig, fetchFn: typeof globalThis.fetch): McpServer {
  const server = new McpServer(
    { name: "neural-labs", version: "0.2.0" },
    {
      instructions:
        "This server requires Microsoft Entra authentication. Use whoami to confirm the signed-in identity before performing user-specific work. Team Chat tools also require an active Neural Labs account and enforce channel membership in the control plane. Never treat identity fields as authorization beyond the scopes validated by the server.",
    },
  );

  server.registerTool(
    "whoami",
    {
      title: "Show signed-in Microsoft identity",
      description: "Return the Microsoft Entra identity attached to this authenticated MCP request.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        subject: z.string(),
        objectId: z.string().optional(),
        tenantId: z.string(),
        displayName: z.string().optional(),
        username: z.string().optional(),
        email: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const identity = identityFromAuth(authInfo);
      return {
        content: [{ type: "text", text: JSON.stringify(identity) }],
        structuredContent: identity,
      };
    },
  );

  if (config.teamApi) {
    const identity = () => identityFromAuth(authInfo);
    server.registerTool(
      "list_team_channels",
      {
        title: "List Neural Labs Team Chats",
        description: "List Team Chat channels the signed-in Neural Labs user can access, with pins and unread counts.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async () => mcpValue(await teamRequest(config, identity(), "list-channels", {}, fetchFn)),
    );
    server.registerTool(
      "list_team_directory",
      {
        title: "List Neural Labs teammates",
        description: "List active teammates and their unique @handles. Use IDs from this tool when creating a restricted channel.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async () => mcpValue(await teamRequest(config, identity(), "directory", {}, fetchFn)),
    );
    server.registerTool(
      "read_team_channel",
      {
        title: "Read a Neural Labs Team Chat",
        description: "Read recent messages from a Team Chat the signed-in user can access.",
        inputSchema: z.object({ channelId: z.string().uuid(), before: z.number().int().positive().optional(), limit: z.number().int().min(1).max(500).default(500) }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (input) => mcpValue(await teamRequest(config, identity(), "list-messages", input, fetchFn)),
    );
    server.registerTool(
      "list_team_channel_members",
      {
        title: "List Team Chat members",
        description: "List the active members of a Team Chat the signed-in user can access.",
        inputSchema: z.object({ channelId: z.string().uuid() }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (input) => mcpValue(await teamRequest(config, identity(), "list-members", input, fetchFn)),
    );
    server.registerTool(
      "create_team_channel",
      {
        title: "Create a Neural Labs Team Chat",
        description: "Create an Everyone channel or a restricted Team Chat with one or more active teammate IDs.",
        inputSchema: z.object({ name: z.string().trim().min(1).max(80), audience: z.enum(["restricted", "everyone"]), memberIds: z.array(z.string().uuid()).max(2_000).default([]) }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      async (input) => mcpValue(await teamRequest(config, identity(), "create-channel", input, fetchFn)),
    );
    server.registerTool(
      "post_team_channel_message",
      {
        title: "Post to a Neural Labs Team Chat",
        description: "Post a message as the signed-in Neural Labs user. Include $Neura only when the team intentionally wants to invoke the agent.",
        inputSchema: z.object({ channelId: z.string().uuid(), body: z.string().trim().min(1).max(128 * 1024) }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      async (input) => mcpValue(await teamRequest(config, identity(), "post-message", { ...input, clientRequestId: randomUUID(), attachments: [] }, fetchFn)),
    );
  }

  return server;
}

export function createApplication(
  config: McpConfig,
  verifier: OAuthTokenVerifier = new EntraTokenVerifier(config),
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): McpApplication {
  const appOptions = {
    host: config.host,
    allowedHosts: config.allowedHosts,
    jsonLimit: "1mb",
    ...(config.allowedOrigins ? { allowedOrigins: config.allowedOrigins } : {}),
  };
  const app = createMcpExpressApp(appOptions);
  app.disable("x-powered-by");
  mountEntraOAuthProxy(app, config, fetchFn);

  const oauthMetadata = buildOAuthMetadata(config);
  app.get("/healthz", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });
  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata,
      resourceServerUrl: config.publicUrl,
      scopesSupported: [config.oauthScope],
      resourceName: "Neural Labs MCP",
    }),
  );

  const handler = createMcpHandler(
    ({ authInfo }) => buildMcpServer(authInfo, config, fetchFn),
    {
      legacy: "stateless",
      onerror: (error) => console.error("MCP request failed", error),
    },
  );
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => console.error("MCP adapter failed", error),
  });
  const authenticate = requireBearerAuth({
    verifier,
    requiredScopes: [config.oauthScope],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(config.publicUrl),
  });

  app.all(
    config.publicUrl.pathname,
    authenticate,
    (request: Request, response: Response, next: NextFunction) => {
      void nodeHandler(request, response, request.body).catch(next);
    },
  );

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error("Unhandled HTTP error", error);
    if (!response.headersSent) {
      response.status(500).json({ error: "internal_server_error" });
    }
  });

  return {
    app,
    close: () => handler.close(),
  };
}
