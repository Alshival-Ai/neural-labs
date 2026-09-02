const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export interface McpConfig {
  azureClientId: string;
  azureTenantId: string;
  azureAuthorityHost: URL;
  azureIssuer: string;
  azureJwksUrl: URL;
  azureAuthorizationUrl: URL;
  azureTokenUrl: URL;
  publicUrl: URL;
  oauthIssuer: string;
  oauthAuthorizationUrl: URL;
  oauthTokenUrl: URL;
  oauthScope: string;
  requiredScope: string;
  tokenAudience: string;
  host: string;
  port: number;
  allowedHosts: string[];
  allowedOrigins?: string[];
  teamApi?: { url: URL; token: string };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseAbsoluteUrl(value: string, name: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must not include credentials, a query, or a fragment`);
  }
  return parsed;
}

function parseAuthorityHost(value: string): URL {
  const url = parseAbsoluteUrl(value, "AZURE_AUTHORITY_HOST");
  if (url.protocol !== "https:") {
    throw new Error("AZURE_AUTHORITY_HOST must use HTTPS");
  }
  if (url.pathname !== "/") {
    throw new Error("AZURE_AUTHORITY_HOST must be an origin without a path");
  }
  return url;
}

function parsePublicUrl(value: string): URL {
  const url = parseAbsoluteUrl(value, "MCP_PUBLIC_URL");
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("MCP_PUBLIC_URL must use HTTPS except for loopback development");
  }
  if (url.pathname === "/") {
    throw new Error("MCP_PUBLIC_URL must include the MCP endpoint path, such as /mcp");
  }
  return url;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("MCP_PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const items = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  return items.length > 0 ? items : undefined;
}

function endpoint(authorityHost: URL, path: string): URL {
  return new URL(path, authorityHost);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const azureClientId = required(env, "AZURE_CLIENT_ID");
  const azureTenantId = required(env, "AZURE_TENANT_ID");
  const azureAuthorityHost = parseAuthorityHost(
    env.AZURE_AUTHORITY_HOST?.trim() || "https://login.microsoftonline.com",
  );
  const publicUrl = parsePublicUrl(required(env, "MCP_PUBLIC_URL"));
  const oauthIssuer = publicUrl.origin;
  const tenantPath = encodeURIComponent(azureTenantId);
  const oauthScope =
    env.MCP_OAUTH_SCOPE?.trim() || `api://${azureClientId}/mcp.access`;
  const requiredScope = env.MCP_REQUIRED_SCOPE?.trim() || "mcp.access";
  const host = env.MCP_HOST?.trim() || "127.0.0.1";
  const configuredHosts = parseList(env.MCP_ALLOWED_HOSTS);
  const allowedHosts = configuredHosts ?? [
    ...new Set([publicUrl.hostname, host, "127.0.0.1", "localhost"]),
  ];
  const allowedOrigins = parseList(env.MCP_ALLOWED_ORIGINS);
  const teamApiUrlValue = env.MCP_TEAM_API_URL?.trim();
  const teamApiToken = env.MCP_CONFIG_TOKEN?.trim();
  let teamApi: McpConfig["teamApi"];
  if (teamApiUrlValue) {
    if (!teamApiToken || teamApiToken.length < 32) {
      throw new Error("MCP_TEAM_API_URL and MCP_CONFIG_TOKEN are both required for Team Chat tools");
    }
    const url = parseAbsoluteUrl(teamApiUrlValue, "MCP_TEAM_API_URL");
    if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("MCP_TEAM_API_URL must use HTTP or HTTPS");
    teamApi = { url, token: teamApiToken };
  }

  return {
    azureClientId,
    azureTenantId,
    azureAuthorityHost,
    azureIssuer: `${azureAuthorityHost.origin}/${tenantPath}/v2.0`,
    azureJwksUrl: endpoint(
      azureAuthorityHost,
      `/${tenantPath}/discovery/v2.0/keys`,
    ),
    azureAuthorizationUrl: endpoint(
      azureAuthorityHost,
      `/${tenantPath}/oauth2/v2.0/authorize`,
    ),
    azureTokenUrl: endpoint(
      azureAuthorityHost,
      `/${tenantPath}/oauth2/v2.0/token`,
    ),
    publicUrl,
    oauthIssuer,
    oauthAuthorizationUrl: new URL("/oauth/authorize", oauthIssuer),
    oauthTokenUrl: new URL("/oauth/token", oauthIssuer),
    oauthScope,
    requiredScope,
    tokenAudience: env.MCP_TOKEN_AUDIENCE?.trim() || azureClientId,
    host,
    port: parsePort(env.MCP_PORT),
    allowedHosts,
    ...(allowedOrigins ? { allowedOrigins } : {}),
    ...(teamApi ? { teamApi } : {}),
  };
}
