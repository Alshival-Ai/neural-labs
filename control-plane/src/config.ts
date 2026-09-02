import { readFile } from "node:fs/promises";

import { z } from "zod";

import type { EntraCredential, EffectiveEntraConfig } from "./types.js";
import { normalizeCertificateCredential } from "./crypto.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export interface ControlPlaneConfig {
  host: string;
  port: number;
  publicOrigin?: URL;
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl: boolean;
  };
  masterKey: Buffer;
  mcpConfigToken: string;
  workspace: {
    statusUrl: URL;
    controlUrl: URL;
    teamAgentUrl: URL;
    controlToken: string;
    openclawVersion: string;
    codexVersion: string;
  };
  environmentEntra?: EffectiveEntraConfig;
  autoSetup: boolean;
  initialAdminEmail?: string;
  setupDefaults: {
    localAuthEnabled: boolean;
    microsoftAuthEnabled: boolean;
    microsoftMcpEnabled: boolean;
  };
  secureCookies: boolean;
}

async function readOptionalFile(env: NodeJS.ProcessEnv, name: string): Promise<string | undefined> {
  const filename = env[name]?.trim();
  if (!filename) return undefined;
  const value = (await readFile(filename, "utf8")).trim();
  return value || undefined;
}

function parsePort(value: string | undefined, fallback: number, name: string): number {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return port;
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export function parsePublicOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Public origin must be an absolute URL");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Public origin must contain only scheme, host, and optional port");
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Public origin must use HTTPS except for loopback development");
  }
  return url;
}

function parseMasterKey(value: string): Buffer {
  const decoded = /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    throw new Error("Control-plane master key must contain 32 bytes as hex or base64");
  }
  return decoded;
}

async function loadEnvironmentEntra(env: NodeJS.ProcessEnv): Promise<EffectiveEntraConfig | undefined> {
  const tenantId = env.AZURE_TENANT_ID?.trim();
  const clientId = env.AZURE_CLIENT_ID?.trim();
  const authorityHost = env.AZURE_AUTHORITY_HOST?.trim() || "https://login.microsoftonline.com";
  const secret = (await readOptionalFile(env, "AZURE_CLIENT_SECRET_FILE")) ?? env.AZURE_CLIENT_SECRET?.trim();
  const certificatePath = env.AZURE_CLIENT_CERTIFICATE_PATH?.trim();
  const certificateBase64 =
    (await readOptionalFile(env, "AZURE_CLIENT_CERTIFICATE_BASE64_FILE")) ??
    env.AZURE_CLIENT_CERTIFICATE_BASE64?.trim();
  const certificatePassphrase =
    (await readOptionalFile(env, "AZURE_CLIENT_CERTIFICATE_PASSPHRASE_FILE")) ??
    env.AZURE_CLIENT_CERTIFICATE_PASSPHRASE?.trim();

  if (!tenantId && !clientId && !secret && !certificatePath && !certificateBase64) return undefined;
  if (!tenantId || !clientId) {
    throw new Error("Environment Entra fallback requires AZURE_TENANT_ID and AZURE_CLIENT_ID");
  }
  if (secret && (certificatePath || certificateBase64)) {
    throw new Error("Choose either AZURE_CLIENT_SECRET or a certificate credential, not both");
  }
  if (certificatePath && certificateBase64) {
    throw new Error("Choose either AZURE_CLIENT_CERTIFICATE_PATH or AZURE_CLIENT_CERTIFICATE_BASE64");
  }

  let credential: EntraCredential;
  if (certificatePath) {
    credential = normalizeCertificateCredential(
      await readFile(certificatePath, "utf8"),
      certificatePassphrase,
    );
  } else if (certificateBase64) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(certificateBase64) || certificateBase64.length % 4 !== 0) {
      throw new Error("AZURE_CLIENT_CERTIFICATE_BASE64 is not valid base64");
    }
    const pem = Buffer.from(certificateBase64, "base64").toString("utf8");
    if (!pem.includes("-----BEGIN CERTIFICATE-----")) {
      throw new Error("AZURE_CLIENT_CERTIFICATE_BASE64 must decode to a PEM credential bundle");
    }
    credential = normalizeCertificateCredential(pem, certificatePassphrase);
  } else if (secret) {
    credential = { type: "secret", clientSecret: secret };
  } else {
    throw new Error(
      "Environment Entra fallback requires a client secret or certificate credential",
    );
  }

  const authority = parsePublicOrigin(authorityHost);
  if (authority.protocol !== "https:") throw new Error("AZURE_AUTHORITY_HOST must use HTTPS");

  return {
    source: "environment",
    tenantId,
    clientId,
    authorityHost: authority.origin,
    credential,
  };
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<ControlPlaneConfig> {
  const masterKeyValue =
    (await readOptionalFile(env, "CONTROL_PLANE_MASTER_KEY_FILE")) ??
    env.CONTROL_PLANE_MASTER_KEY?.trim();
  if (!masterKeyValue) {
    throw new Error("CONTROL_PLANE_MASTER_KEY_FILE or CONTROL_PLANE_MASTER_KEY is required");
  }
  const masterKey = parseMasterKey(masterKeyValue);
  const mcpConfigToken =
    (await readOptionalFile(env, "MCP_CONFIG_TOKEN_FILE")) ?? env.MCP_CONFIG_TOKEN?.trim();
  if (!mcpConfigToken) {
    throw new Error("MCP_CONFIG_TOKEN_FILE or MCP_CONFIG_TOKEN is required");
  }
  if (mcpConfigToken.length < 32) {
    throw new Error("MCP config token must contain at least 32 characters");
  }
  const workspaceControlToken =
    (await readOptionalFile(env, "WORKSPACE_CONTROL_TOKEN_FILE")) ??
    env.WORKSPACE_CONTROL_TOKEN?.trim();
  if (!workspaceControlToken || workspaceControlToken.length < 32) {
    throw new Error("Workspace control token must contain at least 32 characters");
  }

  const publicOriginValue = env.CONTROL_PLANE_PUBLIC_ORIGIN?.trim();
  const publicOrigin = publicOriginValue ? parsePublicOrigin(publicOriginValue) : undefined;
  const password =
    (await readOptionalFile(env, "PGPASSWORD_FILE")) ?? env.PGPASSWORD?.trim();
  if (!password) throw new Error("PGPASSWORD_FILE or PGPASSWORD is required");

  const ssl = z.enum(["true", "false"]).default("false").parse(env.PGSSLMODE === "require" ? "true" : env.DATABASE_SSL);

  const environmentEntra = await loadEnvironmentEntra(env);
  const workspaceStatusUrl = new URL(
    env.CONTROL_PLANE_WORKSPACE_STATUS_URL?.trim() || "http://workspace:18790/status",
  );
  if (!new Set(["http:", "https:"]).has(workspaceStatusUrl.protocol)) {
    throw new Error("CONTROL_PLANE_WORKSPACE_STATUS_URL must use HTTP or HTTPS");
  }
  const workspaceControlUrl = new URL(
    env.CONTROL_PLANE_WORKSPACE_CONTROL_URL?.trim() ||
      "http://workspace:18790/internal/provider-auth/openai",
  );
  if (!new Set(["http:", "https:"]).has(workspaceControlUrl.protocol)) {
    throw new Error("CONTROL_PLANE_WORKSPACE_CONTROL_URL must use HTTP or HTTPS");
  }
  const workspaceTeamAgentUrl = new URL(
    env.CONTROL_PLANE_WORKSPACE_TEAM_AGENT_URL?.trim() ||
      "http://workspace:18790/internal/neura/team-run",
  );
  if (!new Set(["http:", "https:"]).has(workspaceTeamAgentUrl.protocol)) {
    throw new Error("CONTROL_PLANE_WORKSPACE_TEAM_AGENT_URL must use HTTP or HTTPS");
  }
  const setupDefaults = {
    localAuthEnabled: parseBoolean(
      env.CONTROL_PLANE_DEFAULT_LOCAL_AUTH_ENABLED,
      true,
      "CONTROL_PLANE_DEFAULT_LOCAL_AUTH_ENABLED",
    ),
    microsoftAuthEnabled: parseBoolean(
      env.CONTROL_PLANE_DEFAULT_MICROSOFT_AUTH_ENABLED,
      false,
      "CONTROL_PLANE_DEFAULT_MICROSOFT_AUTH_ENABLED",
    ),
    microsoftMcpEnabled: parseBoolean(
      env.CONTROL_PLANE_DEFAULT_MCP_ENABLED,
      false,
      "CONTROL_PLANE_DEFAULT_MCP_ENABLED",
    ),
  };
  const autoSetup = parseBoolean(env.CONTROL_PLANE_AUTO_SETUP, false, "CONTROL_PLANE_AUTO_SETUP");
  const initialAdminValue = env.CONTROL_PLANE_INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const initialAdmin = initialAdminValue
    ? z.string().email().max(320).safeParse(initialAdminValue)
    : undefined;
  if (initialAdmin && !initialAdmin.success) {
    throw new Error("CONTROL_PLANE_INITIAL_ADMIN_EMAIL must be a valid email address");
  }
  if (autoSetup) {
    if (!publicOrigin) throw new Error("CONTROL_PLANE_AUTO_SETUP requires CONTROL_PLANE_PUBLIC_ORIGIN");
    if (!initialAdmin?.success) {
      throw new Error("CONTROL_PLANE_AUTO_SETUP requires CONTROL_PLANE_INITIAL_ADMIN_EMAIL");
    }
    if (!setupDefaults.localAuthEnabled && !setupDefaults.microsoftAuthEnabled) {
      throw new Error("Environment setup must enable at least one web login provider");
    }
    if ((setupDefaults.microsoftAuthEnabled || setupDefaults.microsoftMcpEnabled) && !environmentEntra) {
      throw new Error("Microsoft environment setup requires complete Entra configuration");
    }
  }

  return {
    host: env.CONTROL_PLANE_HOST?.trim() || "127.0.0.1",
    port: parsePort(env.CONTROL_PLANE_PORT, 4174, "CONTROL_PLANE_PORT"),
    ...(publicOrigin ? { publicOrigin } : {}),
    database: {
      host: env.PGHOST?.trim() || "127.0.0.1",
      port: parsePort(env.PGPORT, 5432, "PGPORT"),
      database: env.PGDATABASE?.trim() || "neural_labs",
      user: env.PGUSER?.trim() || "neural_labs",
      password,
      ssl: ssl === "true",
    },
    masterKey,
    mcpConfigToken,
    workspace: {
      statusUrl: workspaceStatusUrl,
      controlUrl: workspaceControlUrl,
      teamAgentUrl: workspaceTeamAgentUrl,
      controlToken: workspaceControlToken,
      openclawVersion: env.CONTROL_PLANE_WORKSPACE_OPENCLAW_VERSION?.trim() || "2026.8.2",
      codexVersion: env.CONTROL_PLANE_WORKSPACE_CODEX_VERSION?.trim() || "0.152.0",
    },
    ...(environmentEntra ? { environmentEntra } : {}),
    autoSetup,
    ...(initialAdmin?.success ? { initialAdminEmail: initialAdmin.data } : {}),
    setupDefaults,
    secureCookies: publicOrigin ? publicOrigin.protocol === "https:" : env.NODE_ENV === "production",
  };
}
