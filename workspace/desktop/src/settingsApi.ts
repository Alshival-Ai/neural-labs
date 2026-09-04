export type UserRole = "admin" | "user";
export type UserStatus = "pending" | "active" | "rejected" | "disabled";
export type IdentityProvider = "local" | "microsoft";

export type AdminUser = {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  providers: IdentityProvider[];
  createdAt: string;
  updatedAt: string;
};

export type AuditEvent = {
  id: string;
  actorUserId?: string;
  actorName: string | null;
  action: string;
  targetUserId?: string;
  targetName: string | null;
  metadata: unknown;
  createdAt: string;
};

export type McpSettings = {
  ready: boolean;
  mode: "workspace-local";
  endpoint: string;
  transport: "streamable-http";
  agentServerName: string;
  agentScope: "shared-workspace";
  publicAccess: false;
  providers: {
    googlePlaces: boolean;
    googleGeocoding: boolean;
    klipy: boolean;
    pexels: boolean;
  };
  tools: string[];
};

export type PluginCatalog = {
  plugins: Array<{
    id: string;
    name: string;
    description: string;
    type: "mcp";
    scope: "private" | "global";
    ownership: "user" | "workspace" | "system";
    editable: boolean;
    ready: boolean;
    mcp: McpSettings;
  }>;
};

export type WorkspaceStatus = {
  available: boolean;
  shared: true;
  persistent: true;
  status: "ready" | "starting" | "offline";
  publicUrl: string | null;
  openclawVersion: string;
  codexVersion: string;
  codexAuthenticated: boolean;
  openclawModelReady: boolean;
};

export type WorkspaceProviderAuth = {
  provider: "openai";
  authMethod: "chatgpt";
  state: "disconnected" | "starting" | "awaiting_user" | "connected" | "error";
  authenticated: boolean;
  modelReady: boolean;
  verificationUrl: string | null;
  userCode: string | null;
  expiresAt: string | null;
  message: string | null;
};

export type OverviewData = {
  counts: { pending: number; active: number; activeAdmins: number; inactive: number };
  authentication: {
    localEnabled: boolean;
    microsoftEnabled: boolean;
    microsoftAvailable: boolean;
    microsoftSource: "onboarding" | "environment" | null;
  };
  mcp: McpSettings;
  workspace: WorkspaceStatus;
  recentAudit: AuditEvent[];
};

export type AuthenticationSettings = {
  localAuthEnabled: boolean;
  microsoftAuthEnabled: boolean;
  microsoftAvailable: boolean;
  microsoftSource: "onboarding" | "environment" | null;
  callbackUrl: string | null;
  entra: {
    tenantId: string;
    clientId: string;
    authorityHost: string;
    credentialType: "secret" | "certificate";
    certificateExpiresAt: string | null;
    certificateThumbprint: string | null;
  } | null;
  updatedAt: string;
};

export class SettingsApiError extends Error {
  constructor(message: string, readonly status: number, readonly code = "request_failed") {
    super(message);
  }
}

export async function settingsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const payload = await response.json().catch(() => undefined) as T | { error?: { code?: string; message?: string } } | undefined;
  if (!response.ok) {
    const error = payload as { error?: { code?: string; message?: string } } | undefined;
    throw new SettingsApiError(
      error?.error?.message ?? `Request failed with HTTP ${response.status}`,
      response.status,
      error?.error?.code,
    );
  }
  return payload as T;
}

export function settingsMutationHeaders(csrfToken: string): HeadersInit {
  return { "X-CSRF-Token": csrfToken };
}
