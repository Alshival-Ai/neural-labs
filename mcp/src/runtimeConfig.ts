import { readFile } from "node:fs/promises";

import { z } from "zod";

import { loadConfig, type McpConfig } from "./config.js";

const remoteConfigSchema = z.object({
  version: z.number().int().nonnegative(),
  tenantId: z.string().min(1),
  clientId: z.string().min(1),
  authorityHost: z.string().url(),
  publicUrl: z.string().url(),
  oauthScope: z.string().min(1),
  requiredScope: z.string().min(1),
  tokenAudience: z.string().min(1),
});

const unconfiguredSchema = z.object({
  status: z.literal("unconfigured"),
  version: z.number().int().nonnegative().optional(),
});

export type RuntimeConfigResult =
  | { state: "configured"; version: number; config: McpConfig }
  | { state: "unconfigured"; version?: number };

export interface RuntimeConfigSource {
  url: URL;
  token: string;
  pollIntervalMs: number;
}

function parsePollInterval(value: string | undefined): number {
  const interval = Number(value ?? "30000");
  if (!Number.isInteger(interval) || interval < 5000 || interval > 300000) {
    throw new Error("MCP_CONFIG_POLL_INTERVAL_MS must be between 5000 and 300000");
  }
  return interval;
}

export async function loadRuntimeConfigSource(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeConfigSource | undefined> {
  const rawUrl = env.MCP_CONTROL_PLANE_CONFIG_URL?.trim();
  if (!rawUrl) return undefined;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("MCP_CONTROL_PLANE_CONFIG_URL must be an absolute URL");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("MCP_CONTROL_PLANE_CONFIG_URL must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "MCP_CONTROL_PLANE_CONFIG_URL must not include credentials, a query, or a fragment",
    );
  }

  const tokenFile = env.MCP_CONFIG_TOKEN_FILE?.trim();
  const token = tokenFile
    ? (await readFile(tokenFile, "utf8")).trim()
    : env.MCP_CONFIG_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "MCP_CONFIG_TOKEN_FILE or MCP_CONFIG_TOKEN is required with MCP_CONTROL_PLANE_CONFIG_URL",
    );
  }
  if (token.length < 32) {
    throw new Error("MCP config token must contain at least 32 characters");
  }
  return { url, token, pollIntervalMs: parsePollInterval(env.MCP_CONFIG_POLL_INTERVAL_MS) };
}

export async function fetchRuntimeConfig(
  source: RuntimeConfigSource,
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<RuntimeConfigResult> {
  const response = await fetchFn(source.url, {
    headers: { authorization: `Bearer ${source.token}`, accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (response.status === 503) {
    const result = unconfiguredSchema.safeParse(body);
    return {
      state: "unconfigured",
      ...(result.success && result.data.version !== undefined
        ? { version: result.data.version }
        : {}),
    };
  }
  if (!response.ok) {
    throw new Error(`Control-plane config request failed with HTTP ${response.status}`);
  }
  const remote = remoteConfigSchema.parse(body);
  return {
    state: "configured",
    version: remote.version,
    config: loadConfig({
      ...env,
      AZURE_TENANT_ID: remote.tenantId,
      AZURE_CLIENT_ID: remote.clientId,
      AZURE_AUTHORITY_HOST: remote.authorityHost,
      MCP_PUBLIC_URL: remote.publicUrl,
      MCP_OAUTH_SCOPE: remote.oauthScope,
      MCP_REQUIRED_SCOPE: remote.requiredScope,
      MCP_TOKEN_AUDIENCE: remote.tokenAudience,
    }),
  };
}
