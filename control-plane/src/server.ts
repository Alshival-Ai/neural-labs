import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";

import { AuthConfigurationService } from "./authConfig.js";
import {
  CollaborationError,
  CollaborationStore,
  TEAM_CHAT_LIMITS,
  type TeamAgentRun,
  type TeamMessage,
} from "./collaboration.js";
import type { ControlPlaneConfig } from "./config.js";
import { parsePublicOrigin } from "./config.js";
import {
  CredentialCipher,
  hashPassword,
  hashToken,
  normalizeCertificateCredential,
  normalizeEmail,
  randomToken,
  verifyPassword,
} from "./crypto.js";
import type { Database, SaveSetupInput } from "./database.js";
import { MicrosoftOidcClient } from "./entra.js";
import { WebAuthnService, type WebAuthnOperations } from "./passkeys.js";
import { SessionService } from "./sessions.js";
import type {
  EffectiveEntraConfig,
  EntraCredential,
  IdentityRecord,
  SessionActor,
  StoredInstanceConfig,
  UserRecord,
} from "./types.js";
import {
  errorView,
  setupView,
} from "./views.js";

const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));
const consoleIndex = path.join(publicDirectory, "console", "index.html");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1, fields: 24, fieldSize: 128 * 1024 },
});

const localAccountSchema = z.object({
  email: z.string().trim().email().max(320),
  display_name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(128),
});
const localLoginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(128),
});
const passkeyTransactionSchema = z.string().regex(/^[A-Za-z0-9_-]{20,200}$/);
const registrationResponseSchema = z.object({
  id: z.string().min(1).max(2048),
  rawId: z.string().min(1).max(2048),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string().min(1).max(131_072),
    attestationObject: z.string().min(1).max(524_288),
    transports: z.array(z.string().max(32)).max(16).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: z.string().max(131_072).nullable().optional(),
    authenticatorData: z.string().max(131_072).optional(),
  }).passthrough(),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional().default({}),
  authenticatorAttachment: z.enum(["cross-platform", "platform"]).nullable().optional(),
}).passthrough();
const authenticationResponseSchema = z.object({
  id: z.string().min(1).max(2048),
  rawId: z.string().min(1).max(2048),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string().min(1).max(131_072),
    authenticatorData: z.string().min(1).max(131_072),
    signature: z.string().min(1).max(131_072),
    userHandle: z.string().max(2048).nullable().optional(),
  }).passthrough(),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional().default({}),
  authenticatorAttachment: z.enum(["cross-platform", "platform"]).nullable().optional(),
}).passthrough();
const finishPasskeyRegistrationSchema = z.object({
  transaction: passkeyTransactionSchema,
  name: z.string().trim().min(1).max(80).default("Passkey"),
  response: registrationResponseSchema,
});
const finishPasskeyAuthenticationSchema = z.object({
  transaction: passkeyTransactionSchema,
  response: authenticationResponseSchema,
});
const userIdSchema = z.string().uuid();
const userStateSchema = z
  .object({
    status: z.enum(["pending", "active", "rejected", "disabled"]).optional(),
    role: z.enum(["admin", "user"]).optional(),
  })
  .refine((value) => value.status !== undefined || value.role !== undefined, {
    message: "Provide a status or role",
  });
const authenticationSettingsSchema = z.object({
  localAuthEnabled: z.boolean(),
  microsoftAuthEnabled: z.boolean(),
});
const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{1,31}$/)
  .refine((value) => !new Set(["neura", "everyone", "here", "system", "admin"]).has(value));
const teamChannelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  audience: z.enum(["restricted", "everyone"]),
  memberIds: z.array(z.string().uuid()).max(TEAM_CHAT_LIMITS.membersPerChannel).default([]),
  sourceSessionKey: z.string().trim().min(1).max(500).optional(),
  importedMessages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    body: z.string().trim().min(1).max(TEAM_CHAT_LIMITS.messageCharacters),
    createdAt: z.string().datetime().optional(),
  })).max(TEAM_CHAT_LIMITS.importedMessages).optional(),
}).superRefine((value, context) => {
  const importedCharacters = value.importedMessages?.reduce((total, message) => total + message.body.length, 0) ?? 0;
  if (importedCharacters > TEAM_CHAT_LIMITS.importedCharacters) {
    context.addIssue({ code: "custom", path: ["importedMessages"], message: "Imported chat history is too large" });
  }
});
const teamChannelUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  pinned: z.boolean().optional(),
}).refine((value) => value.name !== undefined || value.pinned !== undefined);
const teamMembersSchema = z.object({ memberIds: z.array(z.string().uuid()).min(1).max(TEAM_CHAT_LIMITS.membersPerChannel) });
const teamMessageSchema = z.object({
  body: z.string().max(TEAM_CHAT_LIMITS.messageCharacters).default(""),
  clientRequestId: z.string().uuid(),
  attachments: z.array(z.object({
    path: z.string().trim().min(1).max(1_024),
    name: z.string().trim().min(1).max(255),
    type: z.string().trim().max(255).optional(),
    size: z.number().int().min(0).max(10 * 1024 * 1024 * 1024).optional(),
  })).max(TEAM_CHAT_LIMITS.attachmentsPerMessage).default([]),
});
const teamReadSchema = z.object({ sequence: z.number().int().min(0) });
const workspaceRuntimeSchema = z.object({
  status: z.enum(["ready", "starting"]),
  openclawVersion: z.string().min(1).max(64),
  codexVersion: z.string().min(1).max(64),
  providerAuthenticated: z.boolean().optional(),
  codexAuthenticated: z.boolean(),
  openclawModelReady: z.boolean(),
  mcp: z.object({
    ready: z.boolean(),
    mode: z.literal("workspace-local"),
    endpoint: z.string().url(),
    transport: z.literal("streamable-http"),
    agentServerName: z.string().min(1).max(80),
    agentScope: z.literal("shared-workspace"),
    publicAccess: z.literal(false),
    providers: z.object({
      googlePlaces: z.boolean(),
      googleGeocoding: z.boolean(),
      klipy: z.boolean(),
      pexels: z.boolean(),
    }),
    tools: z.array(z.string().min(1).max(100)).max(100),
  }),
});
const workspaceProviderAuthSchema = z.object({
  provider: z.literal("openai"),
  authMethod: z.literal("chatgpt"),
  state: z.enum(["disconnected", "starting", "awaiting_user", "connected", "error"]),
  authenticated: z.boolean(),
  modelReady: z.boolean(),
  verificationUrl: z.string().url().startsWith("https://").nullable(),
  userCode: z.string().regex(/^[A-Z0-9][A-Z0-9-]{3,31}$/).nullable(),
  expiresAt: z.string().datetime().nullable(),
  message: z.string().max(500).nullable(),
});
const personalOpenAIAuthSchema = workspaceProviderAuthSchema.extend({
  agentId: z.string().regex(/^nl-[a-z0-9]+$/),
  paused: z.boolean(),
});
const TURN_CREDENTIAL_TTL_SECONDS = 60 * 60;

function personalAgentId(userId: string): string {
  return `nl-${userId.toLowerCase().replace(/[^a-z0-9]/gu, "")}`.slice(0, 63);
}

function checked(value: unknown): boolean {
  return value === "on" || value === "true" || value === true;
}

function wantsJson(request: Request): boolean {
  return request.get("accept")?.includes("application/json") ?? false;
}

function publicUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    handle: user.handle,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function publicProviders(identities: IdentityRecord[]): Array<IdentityRecord["provider"]> {
  return [...new Set(identities.map((identity) => identity.provider))];
}

function publicPasskey(passkey: Awaited<ReturnType<Database["listPasskeys"]>>[number]) {
  return {
    id: passkey.id,
    name: passkey.displayName,
    deviceType: passkey.deviceType,
    backedUp: passkey.backedUp,
    createdAt: passkey.createdAt.toISOString(),
    lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
  };
}

function jsonError(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({ error: { code, message } });
}

function credentialFromRequest(request: Request): EntraCredential | undefined {
  const secret = typeof request.body.client_secret === "string" ? request.body.client_secret.trim() : "";
  const file = request.file;
  if (secret && file) throw new Error("Choose either a client secret or certificate, not both");
  if (file) {
    const passphrase =
      typeof request.body.certificate_passphrase === "string"
        ? request.body.certificate_passphrase
        : undefined;
    return normalizeCertificateCredential(file.buffer.toString("utf8"), passphrase || undefined);
  }
  return secret ? { type: "secret", clientSecret: secret } : undefined;
}

function redirectForActor(actor: SessionActor): string {
  if (actor.user.status === "pending") return "/account/pending";
  if (actor.user.status !== "active") return "/login?error=Account+is+not+active";
  return "/workspace";
}

function redirectForUser(user: UserRecord): string {
  if (user.status === "pending") return "/account/pending";
  if (user.status !== "active") return "/login?error=Account+is+not+active";
  return "/workspace";
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(hashToken(left));
  const rightBuffer = Buffer.from(hashToken(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function handleError(
  response: Response,
  status: number,
  title: string,
  message: string,
): void {
  response.status(status).type("html").send(errorView(status, title, message));
}

export interface ControlPlaneApplication {
  app: Express;
  sessions: SessionService;
  collaboration: CollaborationStore;
}

export type CollaborationEvent =
  | { type: "channels.changed"; channelId?: string }
  | { type: "message.created"; channelId: string; message: TeamMessage }
  | { type: "agent.status"; channelId: string; run: TeamAgentRun };

export function createApplication(input: {
  database: Database;
  config: ControlPlaneConfig;
  oidc?: MicrosoftOidcClient;
  workspaceFetch?: typeof fetch;
  collaboration?: CollaborationStore;
  webauthn?: WebAuthnOperations;
  onCollaborationEvent?: (event: CollaborationEvent) => void;
  onAgentRun?: (run: TeamAgentRun & { capability: string }) => void;
}): ControlPlaneApplication {
  const { database, config } = input;
  const cipher = new CredentialCipher(config.masterKey);
  const authConfiguration = new AuthConfigurationService(database, config, cipher);
  const sessions = new SessionService(database, config);
  const collaboration = input.collaboration ?? new CollaborationStore(database.pool);
  const oidc = input.oidc ?? new MicrosoftOidcClient();
  const webauthn = input.webauthn ?? new WebAuthnService();
  const workspaceFetch = input.workspaceFetch ?? fetch;
  const app = express();
  const publish = (event: CollaborationEvent) => input.onCollaborationEvent?.(event);
  app.disable("x-powered-by");
  // Host Nginx reaches the container through Docker's private bridge gateway.
  // Trust only loopback/private proxy hops so X-Forwarded-Proto reflects TLS.
  app.set("trust proxy", "loopback, linklocal, uniquelocal");
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));
  const ordinaryJson = express.json({ limit: "512kb" });
  const teamImportJson = express.json({ limit: "24mb" });
  app.use((request, response, next) => {
    const parser = request.method === "POST" && request.path === "/api/team/channels"
      ? teamImportJson
      : ordinaryJson;
    parser(request, response, next);
  });
  app.use(
    "/control-assets",
    express.static(publicDirectory, {
      fallthrough: false,
      dotfiles: "deny",
      etag: true,
      immutable: false,
      maxAge: 0,
    }),
  );

  app.use((request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  const sameOrigin = (request: Request, response: Response, next: NextFunction) => {
    const origin = request.get("origin");
    const fetchSite = request.get("sec-fetch-site");
    const requestOrigin = `${request.protocol}://${request.get("host")}`;
    if ((origin && origin !== requestOrigin) || fetchSite === "cross-site") {
      handleError(response, 403, "Request blocked", "The request did not originate from this Neural Labs instance.");
      return;
    }
    next();
  };

  const requireActor = async (
    request: Request,
    response: Response,
  ): Promise<SessionActor | undefined> => {
    const actor = await sessions.actor(request);
    if (!actor) {
      response.redirect(303, "/login?error=Please+log+in");
      return undefined;
    }
    return actor;
  };

  const requireActive = async (
    request: Request,
    response: Response,
  ): Promise<SessionActor | undefined> => {
    const actor = await requireActor(request, response);
    if (!actor) return undefined;
    if (actor.user.status !== "active") {
      response.redirect(303, redirectForActor(actor));
      return undefined;
    }
    return actor;
  };

  const requireAdmin = async (
    request: Request,
    response: Response,
  ): Promise<SessionActor | undefined> => {
    const actor = await requireActive(request, response);
    if (!actor) return undefined;
    if (actor.user.role !== "admin") {
      handleError(response, 403, "Administrator required", "This operation is restricted to instance administrators.");
      return undefined;
    }
    return actor;
  };

  const requireCsrf = (request: Request, response: Response, actor: SessionActor): boolean => {
    if (!sessions.validateCsrf(request, actor)) {
      handleError(response, 403, "Request expired", "Refresh the page and try again.");
      return false;
    }
    return true;
  };

  const sendConsole = (response: Response): void => {
    response.sendFile(consoleIndex);
  };

  const requireActorJson = async (
    request: Request,
    response: Response,
  ): Promise<SessionActor | undefined> => {
    const actor = await sessions.actor(request);
    if (!actor) {
      jsonError(response, 401, "authentication_required", "Please log in.");
      return undefined;
    }
    return actor;
  };

  const requireActiveJson = async (
    request: Request,
    response: Response,
  ): Promise<SessionActor | undefined> => {
    const actor = await requireActorJson(request, response);
    if (!actor) return undefined;
    if (actor.user.status !== "active") {
      jsonError(response, 403, "account_inactive", "This account is not active.");
      return undefined;
    }
    return actor;
  };

  const requireAdminJson = async (
    request: Request,
    response: Response,
  ): Promise<SessionActor | undefined> => {
    const actor = await requireActiveJson(request, response);
    if (!actor) return undefined;
    if (actor.user.role !== "admin") {
      jsonError(response, 403, "administrator_required", "Administrator access is required.");
      return undefined;
    }
    return actor;
  };

  const requireCsrfJson = (request: Request, response: Response, actor: SessionActor): boolean => {
    if (!sessions.validateCsrf(request, actor)) {
      jsonError(response, 403, "csrf_invalid", "Refresh the page and try again.");
      return false;
    }
    return true;
  };

  const authenticationData = async () => {
    const [stored, providers] = await Promise.all([
      database.getInstanceConfig(),
      authConfiguration.providers(),
    ]);
    const entra = authConfiguration.effectiveEntra(stored);
    const publicOrigin = authConfiguration.effectivePublicOrigin(stored);
    return {
      localAuthEnabled: stored.localAuthEnabled,
      microsoftAuthEnabled: stored.microsoftAuthEnabled,
      microsoftAvailable: providers.microsoft.available,
      microsoftSource: providers.microsoft.source ?? null,
      callbackUrl: publicOrigin
        ? new URL("/auth/microsoft/callback", publicOrigin).toString()
        : null,
      entra: entra
        ? {
            tenantId: entra.tenantId,
            clientId: entra.clientId,
            authorityHost: entra.authorityHost,
            credentialType: entra.credential.type,
            certificateExpiresAt:
              entra.credential.type === "certificate" ? entra.credential.expiresAt : null,
            certificateThumbprint:
              entra.credential.type === "certificate" ? entra.credential.thumbprint : null,
          }
        : null,
      updatedAt: stored.updatedAt.toISOString(),
    };
  };

  const mcpData = async () => {
    try {
      const runtimeResponse = await workspaceFetch(config.workspace.statusUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(2_000),
      });
      if (!runtimeResponse.ok) throw new Error(`Workspace status returned ${runtimeResponse.status}`);
      return workspaceRuntimeSchema.parse(await runtimeResponse.json()).mcp;
    } catch {
      return {
        ready: false,
        mode: "workspace-local" as const,
        endpoint: "http://127.0.0.1:8792/mcp",
        transport: "streamable-http" as const,
        agentServerName: "neural-labs-tools",
        agentScope: "shared-workspace" as const,
        publicAccess: false as const,
        providers: {
          googlePlaces: false,
          googleGeocoding: false,
          klipy: false,
          pexels: false,
        },
        tools: [],
      };
    }
  };

  const workspaceData = async () => {
    const stored = await database.getInstanceConfig();
    const origin = authConfiguration.effectivePublicOrigin(stored);
    const publicUrl = origin ? new URL("/workspace", origin).toString() : null;
    try {
      const runtimeResponse = await workspaceFetch(config.workspace.statusUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(2_000),
      });
      if (!runtimeResponse.ok) throw new Error(`Workspace status returned ${runtimeResponse.status}`);
      const runtime = workspaceRuntimeSchema.parse(await runtimeResponse.json());
      return {
        available: Boolean(publicUrl),
        shared: true,
        persistent: true,
        status: runtime.status,
        publicUrl,
        openclawVersion: runtime.openclawVersion,
        codexVersion: runtime.codexVersion,
        codexAuthenticated: runtime.providerAuthenticated ?? runtime.codexAuthenticated,
        openclawModelReady: runtime.openclawModelReady,
      };
    } catch {
      return {
        available: Boolean(publicUrl),
        shared: true,
        persistent: true,
        status: "offline" as const,
        publicUrl,
        openclawVersion: config.workspace.openclawVersion,
        codexVersion: config.workspace.codexVersion,
        codexAuthenticated: false,
        openclawModelReady: false,
      };
    }
  };

  const workspaceProviderData = async (action?: "start" | "cancel") => {
    const url = new URL(config.workspace.controlUrl);
    if (action) url.pathname = `${url.pathname}/${action}`;
    const runtimeResponse = await workspaceFetch(url, {
      method: action ? "POST" : "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.workspace.controlToken}`,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!runtimeResponse.ok) {
      throw new Error(`Workspace provider control returned ${runtimeResponse.status}`);
    }
    return workspaceProviderAuthSchema.parse(await runtimeResponse.json());
  };

  const personalOpenAIData = async (userId: string, action?: "start" | "cancel" | "pause" | "resume") => {
    const url = new URL(config.workspace.personalAuthUrl);
    url.pathname = `${url.pathname.replace(/\/$/u, "")}/${encodeURIComponent(userId)}${action ? `/${action}` : ""}`;
    const runtimeResponse = await workspaceFetch(url, {
      method: action ? "POST" : "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.workspace.controlToken}`,
      },
      signal: AbortSignal.timeout(action === "start" ? 15_000 : 8_000),
    });
    const payload = await runtimeResponse.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
    if (!runtimeResponse.ok) {
      throw new Error(payload?.error?.message ?? `Workspace personal provider control returned ${runtimeResponse.status}`);
    }
    return personalOpenAIAuthSchema.parse(payload);
  };

  app.get("/healthz", async (_request, response) => {
    try {
      await database.ping();
      const providers = await authConfiguration.providers();
      response.status(200).json({ status: "ok", setupComplete: providers.setupComplete });
    } catch {
      response.status(503).json({ status: "unhealthy" });
    }
  });

  app.get("/readyz", async (_request, response) => {
    try {
      await database.ping();
      response.status(200).json({ status: "ready" });
    } catch {
      response.status(503).json({ status: "not_ready" });
    }
  });

  app.get("/setup", async (_request, response) => {
    const stored = await database.getInstanceConfig();
    if (stored.setupComplete) {
      response.redirect(303, "/login");
      return;
    }
    response.type("html").send(
      setupView({
        publicOrigin: config.publicOrigin?.toString(),
        environmentMicrosoft: Boolean(config.environmentEntra),
        tenantId: config.environmentEntra?.tenantId,
        clientId: config.environmentEntra?.clientId,
        authorityHost: config.environmentEntra?.authorityHost ?? "https://login.microsoftonline.com",
        ...config.setupDefaults,
      }),
    );
  });

  app.post("/setup", sameOrigin, upload.single("certificate"), async (request, response) => {
    const stored = await database.getInstanceConfig();
    if (stored.setupComplete) {
      handleError(response, 409, "Setup complete", "This instance has already completed onboarding.");
      return;
    }
    try {
      const publicOrigin = parsePublicOrigin(String(request.body.public_origin ?? ""));
      const localAuthEnabled = checked(request.body.local_enabled);
      const microsoftAuthEnabled = checked(request.body.microsoft_enabled);
      const microsoftMcpEnabled = checked(request.body.mcp_enabled);
      const authorityHost = String(request.body.authority_host || "https://login.microsoftonline.com").trim();
      const authority = parsePublicOrigin(authorityHost);
      if (authority.protocol !== "https:") throw new Error("Microsoft authority must use HTTPS");
      const uploadedCredential = credentialFromRequest(request);
      const tenantId = String(request.body.tenant_id ?? "").trim() || config.environmentEntra?.tenantId;
      const clientId = String(request.body.client_id ?? "").trim() || config.environmentEntra?.clientId;
      const credential = uploadedCredential ?? config.environmentEntra?.credential;
      const microsoftRequested = microsoftAuthEnabled || microsoftMcpEnabled;
      if (microsoftRequested && (!tenantId || !clientId || !credential)) {
        throw new Error("Microsoft requires tenant ID, client ID, and a client secret or PEM credential");
      }
      if (!localAuthEnabled && !microsoftAuthEnabled) {
        throw new Error("Enable at least one web login provider");
      }
      if (microsoftRequested) {
        const effective: EffectiveEntraConfig = {
          source: uploadedCredential ? "onboarding" : "environment",
          tenantId: tenantId!,
          clientId: clientId!,
          authorityHost: authority.origin,
          credential: credential!,
        };
        await oidc.discover(effective);
      }
      const setupInput: SaveSetupInput = {
        publicOrigin: publicOrigin.origin,
        localAuthEnabled,
        microsoftAuthEnabled,
        microsoftMcpEnabled,
        ...(tenantId ? { entraTenantId: tenantId } : {}),
        ...(clientId ? { entraClientId: clientId } : {}),
        entraAuthorityHost: authority.origin,
        ...(uploadedCredential ? { encryptedEntraCredential: cipher.encrypt(uploadedCredential) } : {}),
      };
      await database.saveSetup(setupInput);
      await database.audit(null, "instance.setup_completed", null, {
        localAuthEnabled,
        microsoftAuthEnabled,
        microsoftMcpEnabled,
        entraSource: uploadedCredential ? "onboarding" : config.environmentEntra ? "environment" : "none",
      });
      response.redirect(303, "/login?success=Setup+complete.+Create+or+sign+in+to+the+first+administrator+account.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Setup failed";
      response.status(400).type("html").send(
        setupView({
          publicOrigin: String(request.body.public_origin ?? config.publicOrigin?.toString() ?? ""),
          environmentMicrosoft: Boolean(config.environmentEntra),
          tenantId: String(request.body.tenant_id ?? config.environmentEntra?.tenantId ?? ""),
          clientId: String(request.body.client_id ?? config.environmentEntra?.clientId ?? ""),
          authorityHost: String(request.body.authority_host ?? "https://login.microsoftonline.com"),
          localAuthEnabled: checked(request.body.local_enabled),
          microsoftAuthEnabled: checked(request.body.microsoft_enabled),
          microsoftMcpEnabled: checked(request.body.mcp_enabled),
          error: message,
        }),
      );
    }
  });

  app.get("/login", async (request, response) => {
    const providers = await authConfiguration.providers();
    if (!providers.setupComplete) {
      response.redirect(303, "/setup");
      return;
    }
    const actor = await sessions.actor(request);
    if (actor) {
      response.redirect(303, redirectForActor(actor));
      return;
    }
    sendConsole(response);
  });

  app.get("/signup", async (request, response) => {
    const providers = await authConfiguration.providers();
    if (!providers.setupComplete) return response.redirect(303, "/setup");
    const actor = await sessions.actor(request);
    if (actor) {
      response.redirect(303, redirectForActor(actor));
      return;
    }
    sendConsole(response);
  });

  app.get("/api/auth/providers", async (_request, response) => {
    response.json(await authConfiguration.providers());
  });

  app.post("/api/auth/passkey/options", sameOrigin, async (request, response) => {
    const providers = await authConfiguration.providers();
    if (!providers.passkey.enabled) {
      jsonError(response, 404, "passkey_unavailable", "Passkey login is unavailable.");
      return;
    }
    const allowed = await database.consumeRateLimit(`passkey-options:${request.ip}`, 30, 15 * 60);
    if (!allowed) {
      jsonError(response, 429, "rate_limited", "Too many passkey attempts. Try again later.");
      return;
    }
    const stored = await authConfiguration.getStored();
    const origin = authConfiguration.effectivePublicOrigin(stored);
    if (!origin) {
      jsonError(response, 503, "passkey_unavailable", "Passkey login is unavailable.");
      return;
    }
    const options = await webauthn.authenticationOptions(origin);
    const transaction = randomToken();
    await database.savePasskeyChallenge({
      tokenHash: hashToken(transaction),
      challenge: options.challenge,
      kind: "authentication",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    response.json({ transaction, options });
  });

  app.post("/api/auth/passkey/verify", sameOrigin, async (request, response) => {
    const parsed = finishPasskeyAuthenticationSchema.safeParse(request.body);
    if (!parsed.success) {
      jsonError(response, 401, "passkey_invalid", "Passkey sign-in could not be verified.");
      return;
    }
    const challenge = await database.consumePasskeyChallenge(
      hashToken(parsed.data.transaction),
      "authentication",
    );
    if (!challenge) {
      jsonError(response, 401, "passkey_expired", "This passkey request expired. Try again.");
      return;
    }
    const allowed = await database.consumeRateLimit(
      `passkey:${request.ip}:${hashToken(parsed.data.response.id)}`,
      10,
      15 * 60,
    );
    if (!allowed) {
      jsonError(response, 429, "rate_limited", "Too many passkey attempts. Try again later.");
      return;
    }
    const match = await database.findPasskeyByCredentialId(parsed.data.response.id);
    if (!match || match.user.status === "rejected" || match.user.status === "disabled") {
      jsonError(response, 401, "passkey_invalid", "Passkey sign-in could not be verified.");
      return;
    }
    const stored = await authConfiguration.getStored();
    const origin = authConfiguration.effectivePublicOrigin(stored);
    if (!origin) {
      jsonError(response, 503, "passkey_unavailable", "Passkey login is unavailable.");
      return;
    }
    try {
      const verification = await webauthn.verifyAuthentication(
        origin,
        parsed.data.response as unknown as Parameters<WebAuthnOperations["verifyAuthentication"]>[1],
        challenge.challenge,
        match.passkey,
      );
      if (!verification) {
        jsonError(response, 401, "passkey_invalid", "Passkey sign-in could not be verified.");
        return;
      }
      await database.updatePasskeyUsage(match.passkey.id, verification.newCounter, verification.backedUp);
      await database.audit(match.user.id, "auth.passkey_succeeded", match.user.id, { passkeyId: match.passkey.id });
      await sessions.create(response, match.user.id);
      response.json({ user: publicUser(match.user), redirectTo: redirectForUser(match.user) });
    } catch (error) {
      console.warn("Passkey authentication failed", error instanceof Error ? error.message : error);
      jsonError(response, 401, "passkey_invalid", "Passkey sign-in could not be verified.");
    }
  });

  app.get("/api/session", async (request, response) => {
    const actor = await sessions.actor(request);
    if (!actor) {
      response.json({ authenticated: false });
      return;
    }
    const csrfToken = sessions.csrfToken(request);
    if (!csrfToken) {
      await sessions.destroy(request, response);
      response.json({ authenticated: false });
      return;
    }
    response.json({
      authenticated: true,
      user: publicUser(actor.user),
      providers: publicProviders(actor.identities),
      csrfToken,
      neura: { agentId: personalAgentId(actor.user.id) },
    });
  });

  app.patch("/api/account/profile", sameOrigin, async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    const parsed = z.object({ handle: handleSchema }).safeParse(request.body);
    if (!parsed.success) {
      jsonError(response, 422, "invalid_handle", "Use 2–32 lowercase letters, numbers, dots, dashes, or underscores.");
      return;
    }
    try {
      const user = await database.updateHandle(actor.user.id, parsed.data.handle);
      if (!user) {
        jsonError(response, 404, "user_not_found", "User not found.");
        return;
      }
      publish({ type: "channels.changed" });
      response.json({ user: publicUser(user) });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        jsonError(response, 409, "handle_in_use", "That handle is already in use.");
        return;
      }
      throw error;
    }
  });

  app.get("/api/account/passkeys", async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor) return;
    const passkeys = await database.listPasskeys(actor.user.id);
    response.json({
      eligible: actor.identities.some((identity) => identity.provider === "microsoft"),
      passkeys: passkeys.map(publicPasskey),
    });
  });

  app.post("/api/account/passkeys/registration/options", sameOrigin, async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    if (!actor.identities.some((identity) => identity.provider === "microsoft")) {
      jsonError(response, 403, "microsoft_required", "Sign in with Microsoft before creating a passkey.");
      return;
    }
    const stored = await authConfiguration.getStored();
    const origin = authConfiguration.effectivePublicOrigin(stored);
    if (!origin) {
      jsonError(response, 503, "passkey_unavailable", "Passkey enrollment is unavailable.");
      return;
    }
    const existing = await database.listPasskeys(actor.user.id);
    const { options } = await webauthn.registrationOptions(origin, actor.user, existing);
    const transaction = randomToken();
    await database.savePasskeyChallenge({
      tokenHash: hashToken(transaction),
      challenge: options.challenge,
      kind: "registration",
      userId: actor.user.id,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    response.json({ transaction, options });
  });

  app.post("/api/account/passkeys/registration/verify", sameOrigin, async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    if (!actor.identities.some((identity) => identity.provider === "microsoft")) {
      jsonError(response, 403, "microsoft_required", "Sign in with Microsoft before creating a passkey.");
      return;
    }
    const parsed = finishPasskeyRegistrationSchema.safeParse(request.body);
    if (!parsed.success) {
      jsonError(response, 422, "passkey_invalid", "The passkey response is invalid.");
      return;
    }
    const challenge = await database.consumePasskeyChallenge(
      hashToken(parsed.data.transaction),
      "registration",
      actor.user.id,
    );
    if (!challenge) {
      jsonError(response, 410, "passkey_expired", "This passkey request expired. Try again.");
      return;
    }
    const stored = await authConfiguration.getStored();
    const origin = authConfiguration.effectivePublicOrigin(stored);
    if (!origin) {
      jsonError(response, 503, "passkey_unavailable", "Passkey enrollment is unavailable.");
      return;
    }
    try {
      const registration = await webauthn.verifyRegistration(
        origin,
        parsed.data.response as unknown as Parameters<WebAuthnOperations["verifyRegistration"]>[1],
        challenge.challenge,
      );
      if (!registration) {
        jsonError(response, 422, "passkey_invalid", "The passkey could not be verified.");
        return;
      }
      const passkey = await database.createPasskey({
        userId: actor.user.id,
        credentialId: registration.credentialId,
        webauthnUserId: Buffer.from(actor.user.id, "utf8").toString("base64url"),
        publicKey: registration.publicKey,
        counter: registration.counter,
        deviceType: registration.deviceType,
        backedUp: registration.backedUp,
        transports: registration.transports,
        displayName: parsed.data.name,
      });
      await database.audit(actor.user.id, "passkey.created", actor.user.id, {
        passkeyId: passkey.id,
        deviceType: passkey.deviceType,
        backedUp: passkey.backedUp,
      });
      response.status(201).json({ passkey: publicPasskey(passkey) });
    } catch (error) {
      console.warn("Passkey registration failed", error instanceof Error ? error.message : error);
      const duplicate = (error as { code?: string }).code === "23505";
      jsonError(
        response,
        duplicate ? 409 : 422,
        duplicate ? "passkey_exists" : "passkey_invalid",
        duplicate ? "That passkey is already registered." : "The passkey could not be verified.",
      );
    }
  });

  app.delete("/api/account/passkeys/:passkeyId", sameOrigin, async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    const id = userIdSchema.safeParse(request.params.passkeyId);
    if (!id.success || !(await database.deletePasskey(actor.user.id, id.data))) {
      jsonError(response, 404, "passkey_not_found", "Passkey not found.");
      return;
    }
    await database.audit(actor.user.id, "passkey.deleted", actor.user.id, { passkeyId: id.data });
    response.status(204).end();
  });

  app.get("/api/account/openai", async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor) return;
    try {
      response.json(await personalOpenAIData(actor.user.id));
    } catch (error) {
      jsonError(response, 503, "personal_openai_unavailable", error instanceof Error ? error.message : "Personal OpenAI setup is unavailable.");
    }
  });

  for (const action of ["connect", "cancel", "pause", "resume"] as const) {
    app.post(`/api/account/openai/${action}`, sameOrigin, async (request, response) => {
      const actor = await requireActiveJson(request, response);
      if (!actor || !requireCsrfJson(request, response, actor)) return;
      const workspaceAction = action === "connect" ? "start" : action;
      await database.audit(actor.user.id, `account.openai.${action}_requested`, actor.user.id, {
        provider: "openai",
        authMethod: "chatgpt",
      });
      try {
        const result = await personalOpenAIData(actor.user.id, workspaceAction);
        response.status(action === "connect" ? 202 : 200).json(result);
      } catch (error) {
        jsonError(response, 409, "personal_openai_unavailable", error instanceof Error ? error.message : "Personal OpenAI setup is unavailable.");
      }
    });
  }

  app.get("/api/team/directory", async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor) return;
    response.json({ users: await collaboration.directory() });
  });

  app.get("/api/team/channels", async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor) return;
    response.json({ channels: await collaboration.listChannels(actor.user) });
  });

  app.post("/api/team/socket-ticket", sameOrigin, async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    response.status(201).json(await collaboration.createSocketTicket(actor.user.id));
  });

  app.post("/api/team/channels", sameOrigin, async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    const parsed = teamChannelSchema.safeParse(request.body);
    if (!parsed.success) {
      jsonError(response, 422, "invalid_channel", "Provide a channel name, audience, and valid members.");
      return;
    }
    try {
      const created = await collaboration.createChannel(actor.user, parsed.data);
      await database.audit(actor.user.id, "team.channel_created", null, {
        channelId: created.channel.id,
        audience: created.channel.audience,
        imported: Boolean(parsed.data.sourceSessionKey),
      });
      publish({ type: "channels.changed", channelId: created.channel.id });
      for (const message of created.messages) publish({ type: "message.created", channelId: created.channel.id, message });
      response.status(201).json(created);
    } catch (error) {
      if (error instanceof CollaborationError) {
        jsonError(response, error.status, error.code, error.message);
        return;
      }
      throw error;
    }
  });

  app.patch("/api/team/channels/:channelId", sameOrigin, async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    const channelId = userIdSchema.safeParse(request.params.channelId);
    const parsed = teamChannelUpdateSchema.safeParse(request.body);
    if (!channelId.success || !parsed.success) {
      jsonError(response, 422, "invalid_channel_update", "Provide a valid channel update.");
      return;
    }
    try {
      await collaboration.updateChannel(actor.user, channelId.data, parsed.data);
      await database.audit(actor.user.id, "team.channel_updated", null, { channelId: channelId.data, ...parsed.data });
      publish({ type: "channels.changed", channelId: channelId.data });
      response.status(204).end();
    } catch (error) {
      if (error instanceof CollaborationError) {
        jsonError(response, error.status, error.code, error.message);
        return;
      }
      throw error;
    }
  });

  app.delete("/api/team/channels/:channelId", sameOrigin, async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    const channelId = userIdSchema.safeParse(request.params.channelId);
    if (!channelId.success) {
      jsonError(response, 422, "invalid_channel", "Provide a valid channel.");
      return;
    }
    try {
      await collaboration.deleteChannel(actor.user, channelId.data);
      await database.audit(actor.user.id, "team.channel_deleted", null, { channelId: channelId.data });
      publish({ type: "channels.changed", channelId: channelId.data });
      response.status(204).end();
    } catch (error) {
      if (error instanceof CollaborationError) {
        jsonError(response, error.status, error.code, error.message);
        return;
      }
      throw error;
    }
  });

  app.get("/api/team/channels/:channelId/members", async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor) return;
    const channelId = userIdSchema.safeParse(request.params.channelId);
    if (!channelId.success) {
      jsonError(response, 422, "invalid_channel", "Provide a valid channel.");
      return;
    }
    try {
      response.json({ users: await collaboration.members(actor.user, channelId.data) });
    } catch (error) {
      if (error instanceof CollaborationError) {
        jsonError(response, error.status, error.code, error.message);
        return;
      }
      throw error;
    }
  });

  app.post("/api/team/channels/:channelId/members", sameOrigin, async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    const channelId = userIdSchema.safeParse(request.params.channelId);
    const parsed = teamMembersSchema.safeParse(request.body);
    if (!channelId.success || !parsed.success) {
      jsonError(response, 422, "invalid_members", "Choose one or more valid teammates.");
      return;
    }
    try {
      await collaboration.addMembers(actor.user, channelId.data, parsed.data.memberIds);
      await database.audit(actor.user.id, "team.members_added", null, { channelId: channelId.data, memberIds: parsed.data.memberIds });
      publish({ type: "channels.changed", channelId: channelId.data });
      response.status(204).end();
    } catch (error) {
      if (error instanceof CollaborationError) {
        jsonError(response, error.status, error.code, error.message);
        return;
      }
      throw error;
    }
  });

  app.delete("/api/team/channels/:channelId/members/:userId", sameOrigin, async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    const channelId = userIdSchema.safeParse(request.params.channelId);
    const memberId = userIdSchema.safeParse(request.params.userId);
    if (!channelId.success || !memberId.success) {
      jsonError(response, 422, "invalid_member", "Provide a valid channel member.");
      return;
    }
    try {
      await collaboration.removeMember(actor.user, channelId.data, memberId.data);
      await database.audit(actor.user.id, "team.member_removed", memberId.data, { channelId: channelId.data });
      publish({ type: "channels.changed", channelId: channelId.data });
      response.status(204).end();
    } catch (error) {
      if (error instanceof CollaborationError) {
        jsonError(response, error.status, error.code, error.message);
        return;
      }
      throw error;
    }
  });

  app.get("/api/team/channels/:channelId/messages", async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor) return;
    const channelId = userIdSchema.safeParse(request.params.channelId);
    const query = z.object({
      before: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(TEAM_CHAT_LIMITS.messagesPerPage).default(TEAM_CHAT_LIMITS.messagesPerPage),
    }).safeParse(request.query);
    if (!channelId.success || !query.success) {
      jsonError(response, 422, "invalid_message_query", "Provide a valid channel and message cursor.");
      return;
    }
    try {
      response.json({ messages: await collaboration.listMessages(actor.user, channelId.data, query.data.before, query.data.limit) });
    } catch (error) {
      if (error instanceof CollaborationError) {
        jsonError(response, error.status, error.code, error.message);
        return;
      }
      throw error;
    }
  });

  app.post("/api/team/channels/:channelId/messages", sameOrigin, async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    const channelId = userIdSchema.safeParse(request.params.channelId);
    const parsed = teamMessageSchema.safeParse(request.body);
    if (!channelId.success || !parsed.success) {
      jsonError(response, 422, "invalid_message", "Write a message or attach a valid workspace file.");
      return;
    }
    try {
      const result = await collaboration.postMessage(actor.user, { channelId: channelId.data, ...parsed.data });
      publish({ type: "message.created", channelId: channelId.data, message: result.message });
      publish({ type: "channels.changed", channelId: channelId.data });
      if (result.run) {
        const { capability: _capability, ...publicAgentRun } = result.run;
        publish({ type: "agent.status", channelId: channelId.data, run: publicAgentRun });
        input.onAgentRun?.(result.run);
      }
      const publicRun = result.run ? { ...result.run, capability: undefined } : undefined;
      response.status(201).json({ message: result.message, ...(publicRun ? { run: publicRun } : {}) });
    } catch (error) {
      if (error instanceof CollaborationError) {
        jsonError(response, error.status, error.code, error.message);
        return;
      }
      throw error;
    }
  });

  app.post("/api/team/channels/:channelId/read", sameOrigin, async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    const channelId = userIdSchema.safeParse(request.params.channelId);
    const parsed = teamReadSchema.safeParse(request.body);
    if (!channelId.success || !parsed.success) {
      jsonError(response, 422, "invalid_read_cursor", "Provide a valid channel read cursor.");
      return;
    }
    try {
      await collaboration.markRead(actor.user, channelId.data, parsed.data.sequence);
      response.status(204).end();
    } catch (error) {
      if (error instanceof CollaborationError) {
        jsonError(response, error.status, error.code, error.message);
        return;
      }
      throw error;
    }
  });

  app.get("/api/workspace", async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor) return;
    response.json(await workspaceData());
  });

  app.get("/api/plugins", async (request, response) => {
    const actor = await requireActiveJson(request, response);
    if (!actor) return;
    const mcp = await mcpData();
    response.json({
      plugins: [{
        id: "neural-labs-tools",
        name: "Neural Labs Tools",
        description: "Private provider tools attached automatically to shared workspace agents.",
        type: "mcp",
        scope: "global",
        ownership: "system",
        editable: false,
        ready: mcp.ready,
        mcp,
      }],
    });
  });

  app.get("/api/admin/workspace/provider", async (request, response) => {
    const actor = await requireAdminJson(request, response);
    if (!actor) return;
    try {
      response.json(await workspaceProviderData());
    } catch {
      jsonError(response, 503, "workspace_unavailable", "Workspace provider setup is unavailable.");
    }
  });

  app.post("/api/admin/workspace/provider/connect", sameOrigin, async (request, response) => {
    const actor = await requireAdminJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    await database.audit(actor.user.id, "workspace.provider.connect_requested", null, {
      provider: "openai",
      authMethod: "chatgpt",
    });
    try {
      response.status(202).json(await workspaceProviderData("start"));
    } catch {
      jsonError(response, 503, "workspace_unavailable", "OpenAI sign-in could not be started.");
    }
  });

  app.post("/api/admin/workspace/provider/cancel", sameOrigin, async (request, response) => {
    const actor = await requireAdminJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    await database.audit(actor.user.id, "workspace.provider.connect_cancelled", null, {
      provider: "openai",
    });
    try {
      response.json(await workspaceProviderData("cancel"));
    } catch {
      jsonError(response, 503, "workspace_unavailable", "OpenAI sign-in could not be cancelled.");
    }
  });

  app.post("/api/auth/local/signup", sameOrigin, async (request, response) => {
    const providers = await authConfiguration.providers();
    if (!providers.setupComplete || !providers.local.enabled) {
      if (wantsJson(request)) {
        jsonError(response, 404, "local_signup_unavailable", "Local authentication is disabled.");
      } else {
        handleError(response, 404, "Local signup unavailable", "Local authentication is disabled.");
      }
      return;
    }
    const parsed = localAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      const message = "Enter a valid email, display name, and password of at least 12 characters.";
      if (wantsJson(request)) jsonError(response, 422, "invalid_signup", message);
      else response.redirect(303, `/signup?error=${encodeURIComponent(message)}`);
      return;
    }
    const allowed = await database.consumeRateLimit(
      `signup:${request.ip}:${hashToken(normalizeEmail(parsed.data.email))}`,
      5,
      15 * 60,
    );
    if (!allowed) {
      const message = "Too many signup attempts. Try again later.";
      if (wantsJson(request)) jsonError(response, 429, "rate_limited", message);
      else response.redirect(303, `/signup?error=${encodeURIComponent(message)}`);
      return;
    }
    try {
      const passwordHash = await hashPassword(parsed.data.password);
      const user = await database.createLocalUser({
        email: parsed.data.email,
        displayName: parsed.data.display_name,
        passwordHash,
      }, config.initialAdminEmail);
      await sessions.create(response, user.id);
      const redirectTo = redirectForUser(user);
      if (wantsJson(request)) {
        response.status(201).json({ user: publicUser(user), redirectTo });
      } else {
        response.redirect(303, redirectTo);
      }
    } catch (error) {
      console.error("Local signup failed", error instanceof Error ? error.message : error);
      const message = "That local identity is already registered.";
      if (wantsJson(request)) jsonError(response, 409, "identity_exists", message);
      else response.redirect(303, `/signup?error=${encodeURIComponent(message)}`);
    }
  });

  app.post("/api/auth/local/login", sameOrigin, async (request, response) => {
    const providers = await authConfiguration.providers();
    if (!providers.local.enabled) {
      if (wantsJson(request)) jsonError(response, 404, "local_login_unavailable", "Local login is disabled.");
      else response.redirect(303, "/login?error=Local+login+is+disabled");
      return;
    }
    const parsed = localLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      if (wantsJson(request)) jsonError(response, 401, "invalid_credentials", "Invalid email or password.");
      else response.redirect(303, "/login?error=Invalid+email+or+password");
      return;
    }
    const allowed = await database.consumeRateLimit(
      `login:${request.ip}:${hashToken(normalizeEmail(parsed.data.email))}`,
      8,
      15 * 60,
    );
    if (!allowed) {
      if (wantsJson(request)) jsonError(response, 429, "rate_limited", "Too many login attempts. Try again later.");
      else response.redirect(303, "/login?error=Too+many+login+attempts.+Try+again+later.");
      return;
    }
    const match = await database.findLocalIdentity(parsed.data.email);
    if (!match?.identity.passwordHash || !(await verifyPassword(match.identity.passwordHash, parsed.data.password))) {
      if (wantsJson(request)) jsonError(response, 401, "invalid_credentials", "Invalid email or password.");
      else response.redirect(303, "/login?error=Invalid+email+or+password");
      return;
    }
    if (match.user.status === "rejected" || match.user.status === "disabled") {
      if (wantsJson(request)) jsonError(response, 403, "account_inactive", "Account is not active.");
      else response.redirect(303, "/login?error=Account+is+not+active");
      return;
    }
    await sessions.create(response, match.user.id);
    const redirectTo = redirectForUser(match.user);
    if (wantsJson(request)) response.json({ user: publicUser(match.user), redirectTo });
    else response.redirect(303, redirectTo);
  });

  app.get("/auth/microsoft", async (request, response) => {
    const stored = await authConfiguration.getStored();
    const entra = authConfiguration.effectiveEntra(stored);
    const publicOrigin = authConfiguration.effectivePublicOrigin(stored);
    if (!stored.setupComplete || !stored.microsoftAuthEnabled || !entra || !publicOrigin) {
      handleError(response, 404, "Microsoft login unavailable", "Microsoft authentication is not configured and enabled.");
      return;
    }
    const intent = request.query.intent === "link" ? "link" : "login";
    let actor: SessionActor | undefined;
    if (intent === "link") {
      actor = await requireActive(request, response);
      if (!actor) return;
    }
    const authorization = await oidc.authorizationRequest({
      config: entra,
      publicOrigin,
      intent,
      ...(actor ? { sessionUserId: actor.user.id } : {}),
    });
    await database.saveOidcTransaction(authorization.transaction);
    response.redirect(302, authorization.url.toString());
  });

  app.get("/auth/microsoft/callback", async (request, response) => {
    const state = typeof request.query.state === "string" ? request.query.state : undefined;
    const code = typeof request.query.code === "string" ? request.query.code : undefined;
    const providerError = typeof request.query.error === "string" ? request.query.error : undefined;
    if (providerError) {
      const transaction = state ? await database.consumeOidcTransaction(hashToken(state)) : undefined;
      if (transaction?.intent === "link") {
        response.redirect(303, "/workspace?settings=personalization&error=Microsoft+identity+linking+was+not+completed");
        return;
      }
      response.redirect(303, "/login?error=Microsoft+sign-in+was+not+completed");
      return;
    }
    if (!state || !code) {
      response.redirect(303, "/login?error=Invalid+Microsoft+callback");
      return;
    }
    const transaction = await database.consumeOidcTransaction(hashToken(state));
    if (!transaction) {
      response.redirect(303, "/login?error=Microsoft+sign-in+request+expired");
      return;
    }
    try {
      const stored = await authConfiguration.getStored();
      const entra = authConfiguration.effectiveEntra(stored);
      const publicOrigin = authConfiguration.effectivePublicOrigin(stored);
      if (!stored.microsoftAuthEnabled || !entra || !publicOrigin) throw new Error("Microsoft login is disabled");
      const claims = await oidc.exchange({ config: entra, publicOrigin, transaction, code });
      if (transaction.intent === "link") {
        const actor = await requireActive(request, response);
        if (!actor) return;
        if (actor.user.id !== transaction.sessionUserId) throw new Error("Identity-link session mismatch");
        await database.linkMicrosoftIdentity(actor.user.id, claims);
        response.redirect(303, "/workspace?settings=personalization&success=Microsoft+identity+linked");
        return;
      }
      const user = await database.findOrCreateMicrosoftUser(claims, config.initialAdminEmail);
      if (user.status === "rejected" || user.status === "disabled") {
        response.redirect(303, "/login?error=Account+is+not+active");
        return;
      }
      await sessions.create(response, user.id);
      response.redirect(303, redirectForUser(user));
    } catch (error) {
      console.error("Microsoft callback failed", error instanceof Error ? error.message : error);
      response.redirect(303, transaction.intent === "link"
        ? "/workspace?settings=personalization&error=Microsoft+identity+could+not+be+linked"
        : "/login?error=Microsoft+sign-in+could+not+be+verified");
    }
  });

  app.post("/api/auth/logout", sameOrigin, async (request, response) => {
    const actor = wantsJson(request)
      ? await requireActorJson(request, response)
      : await requireActor(request, response);
    if (!actor) return;
    const csrfValid = wantsJson(request)
      ? requireCsrfJson(request, response, actor)
      : requireCsrf(request, response, actor);
    if (!csrfValid) return;
    await sessions.destroy(request, response);
    if (wantsJson(request)) response.json({ redirectTo: "/login?success=Logged+out" });
    else response.redirect(303, "/login?success=Logged+out");
  });

  app.get("/account/pending", async (request, response) => {
    const actor = await requireActor(request, response);
    if (!actor) return;
    if (actor.user.status === "active") return response.redirect(303, redirectForActor(actor));
    if (actor.user.status !== "pending") return response.redirect(303, "/login?error=Account+is+not+active");
    sendConsole(response);
  });

  app.get("/account", async (request, response) => {
    const actor = await requireActive(request, response);
    if (!actor) return;
    response.redirect(303, "/workspace?settings=personalization");
  });

  app.post("/api/account/identities/local", sameOrigin, async (request, response) => {
    const actor = wantsJson(request)
      ? await requireActiveJson(request, response)
      : await requireActive(request, response);
    if (!actor) return;
    const csrfValid = wantsJson(request)
      ? requireCsrfJson(request, response, actor)
      : requireCsrf(request, response, actor);
    if (!csrfValid) return;
    const password = typeof request.body.password === "string" ? request.body.password : "";
    if (password.length < 12 || password.length > 128) {
      if (wantsJson(request)) jsonError(response, 422, "invalid_password", "Local password must be between 12 and 128 characters.");
      else response.redirect(303, "/workspace?settings=personalization&error=Local+password+must+be+between+12+and+128+characters");
      return;
    }
    if (actor.identities.some((identity) => identity.provider === "local")) {
      if (wantsJson(request)) jsonError(response, 409, "identity_exists", "A local identity is already linked.");
      else response.redirect(303, "/workspace?settings=personalization&error=Local+identity+is+already+linked");
      return;
    }
    try {
      await database.addLocalIdentity(actor.user.id, actor.user.email, await hashPassword(password));
      if (wantsJson(request)) response.status(201).json({ provider: "local" });
      else response.redirect(303, "/workspace?settings=personalization&success=Local+identity+linked");
    } catch {
      if (wantsJson(request)) jsonError(response, 409, "identity_in_use", "That local email is linked to another account.");
      else response.redirect(303, "/workspace?settings=personalization&error=That+local+email+is+already+linked+to+another+account");
    }
  });

  app.get("/api/admin/overview", async (request, response) => {
    const actor = await requireAdminJson(request, response);
    if (!actor) return;
    const [users, providers, mcp, workspace, recentAudit] = await Promise.all([
      database.listUsers(),
      authConfiguration.providers(),
      mcpData(),
      workspaceData(),
      database.listAudit(6),
    ]);
    const names = new Map(users.map((user) => [user.id, user.displayName]));
    response.json({
      counts: {
        pending: users.filter((user) => user.status === "pending").length,
        active: users.filter((user) => user.status === "active").length,
        activeAdmins: users.filter(
          (user) => user.status === "active" && user.role === "admin",
        ).length,
        inactive: users.filter(
          (user) => user.status === "disabled" || user.status === "rejected",
        ).length,
      },
      authentication: {
        localEnabled: providers.local.enabled,
        microsoftEnabled: providers.microsoft.enabled,
        microsoftAvailable: providers.microsoft.available,
        microsoftSource: providers.microsoft.source ?? null,
      },
      mcp,
      workspace,
      recentAudit: recentAudit.map((event) => ({
        ...event,
        actorName: event.actorUserId ? names.get(event.actorUserId) ?? null : null,
        targetName: event.targetUserId ? names.get(event.targetUserId) ?? null : null,
        createdAt: event.createdAt.toISOString(),
      })),
    });
  });

  app.get("/api/admin/users", async (request, response) => {
    const actor = await requireAdminJson(request, response);
    if (!actor) return;
    const users = await database.listUsers();
    response.json({
      users: users.map((user) => ({
        ...publicUser(user),
        providers: publicProviders(user.identities),
      })),
    });
  });

  app.patch("/api/admin/users/:userId", sameOrigin, async (request, response) => {
    const actor = await requireAdminJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    const targetUserId = userIdSchema.safeParse(request.params.userId);
    const inputState = userStateSchema.safeParse(request.body);
    if (!targetUserId.success || !inputState.success) {
      jsonError(response, 422, "invalid_user_update", "Provide a valid user, status, or role.");
      return;
    }
    try {
      const updated = await database.setUserState(actor.user.id, targetUserId.data, {
        ...(inputState.data.status ? { status: inputState.data.status } : {}),
        ...(inputState.data.role ? { role: inputState.data.role } : {}),
      });
      if (!updated) {
        jsonError(response, 404, "user_not_found", "User not found.");
        return;
      }
      if (inputState.data.status && inputState.data.status !== "active") {
        await personalOpenAIData(updated.id, "pause").catch(() => undefined);
      }
      response.json({ user: publicUser(updated) });
    } catch (error) {
      if (error instanceof Error && error.message.includes("active administrator")) {
        jsonError(response, 409, "last_administrator", "At least one active administrator must remain.");
        return;
      }
      throw error;
    }
  });

  app.get("/api/admin/authentication", async (request, response) => {
    const actor = await requireAdminJson(request, response);
    if (!actor) return;
    response.json(await authenticationData());
  });

  app.put("/api/admin/authentication", sameOrigin, async (request, response) => {
    const actor = await requireAdminJson(request, response);
    if (!actor || !requireCsrfJson(request, response, actor)) return;
    const parsed = authenticationSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      jsonError(response, 422, "invalid_authentication_settings", "Authentication settings are invalid.");
      return;
    }
    const { localAuthEnabled, microsoftAuthEnabled } = parsed.data;
    const [stored, providers] = await Promise.all([
      database.getInstanceConfig(),
      authConfiguration.providers(),
    ]);
    if (microsoftAuthEnabled && !providers.microsoft.available) {
      jsonError(response, 409, "microsoft_unavailable", "Microsoft credentials are not available.");
      return;
    }
    if (!localAuthEnabled && !microsoftAuthEnabled) {
      jsonError(response, 409, "provider_required", "At least one web login provider must remain enabled.");
      return;
    }
    if (!localAuthEnabled && !(await database.hasActiveAdminWithProvider("microsoft"))) {
      jsonError(
        response,
        409,
        "microsoft_admin_required",
        "Link Microsoft to an active administrator before disabling local login.",
      );
      return;
    }
    await database.updateAuthSettings({
      localAuthEnabled,
      microsoftAuthEnabled,
      microsoftMcpEnabled: stored.microsoftMcpEnabled,
    });
    await database.audit(actor.user.id, "auth.settings_changed", null, {
      localAuthEnabled,
      microsoftAuthEnabled,
      microsoftMcpEnabled: stored.microsoftMcpEnabled,
    });
    response.json(await authenticationData());
  });

  app.get("/api/admin/mcp", async (request, response) => {
    const actor = await requireAdminJson(request, response);
    if (!actor) return;
    response.json(await mcpData());
  });

  app.get("/api/admin/audit", async (request, response) => {
    const actor = await requireAdminJson(request, response);
    if (!actor) return;
    const limitResult = z.coerce.number().int().min(1).max(200).safeParse(request.query.limit ?? 100);
    if (!limitResult.success) {
      jsonError(response, 422, "invalid_limit", "Audit limit must be between 1 and 200.");
      return;
    }
    const [events, users] = await Promise.all([
      database.listAudit(limitResult.data),
      database.listUsers(),
    ]);
    const names = new Map(users.map((user) => [user.id, user.displayName]));
    response.json({
      events: events.map((event) => ({
        ...event,
        actorName: event.actorUserId ? names.get(event.actorUserId) ?? null : null,
        targetName: event.targetUserId ? names.get(event.targetUserId) ?? null : null,
        createdAt: event.createdAt.toISOString(),
      })),
    });
  });

  app.post("/api/admin/entra", sameOrigin, upload.single("certificate"), async (request, response) => {
    const actor = wantsJson(request)
      ? await requireAdminJson(request, response)
      : await requireAdmin(request, response);
    if (!actor) return;
    const csrfValid = wantsJson(request)
      ? requireCsrfJson(request, response, actor)
      : requireCsrf(request, response, actor);
    if (!csrfValid) return;
    try {
      const tenantId = String(request.body.tenant_id ?? "").trim();
      const clientId = String(request.body.client_id ?? "").trim();
      const authority = parsePublicOrigin(String(request.body.authority_host ?? ""));
      const credential = credentialFromRequest(request);
      if (!tenantId || !clientId || !credential) {
        throw new Error("Tenant ID, client ID, and a new client secret or PEM credential are required");
      }
      const effective: EffectiveEntraConfig = {
        source: "onboarding",
        tenantId,
        clientId,
        authorityHost: authority.origin,
        credential,
      };
      await oidc.discover(effective);
      const stored = await database.getInstanceConfig();
      await database.replaceEntraConfiguration({
        tenantId,
        clientId,
        authorityHost: authority.origin,
        encryptedCredential: cipher.encrypt(credential),
        microsoftAuthEnabled: stored.microsoftAuthEnabled,
        microsoftMcpEnabled: stored.microsoftMcpEnabled,
      });
      await database.audit(actor.user.id, "entra.credential_replaced", null, {
        tenantId,
        clientId,
        credentialType: credential.type,
      });
      if (wantsJson(request)) response.json(await authenticationData());
      else response.redirect(303, "/workspace");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Microsoft configuration failed";
      if (wantsJson(request)) jsonError(response, 422, "entra_configuration_failed", message);
      else response.redirect(303, "/workspace");
    }
  });

  app.post("/internal/mcp/team/:operation", async (request, response) => {
    const supplied = request.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!supplied || !safeEqual(supplied, config.mcpConfigToken)) {
      response.status(401).json({ error: { code: "unauthorized", message: "Unauthorized" } });
      return;
    }
    const identity = z.object({
      tenantId: z.string().min(1).max(128),
      subject: z.string().min(1).max(256),
      objectId: z.string().min(1).max(256).optional(),
    }).safeParse(request.body?.identity);
    if (!identity.success) {
      jsonError(response, 422, "invalid_identity", "A valid Microsoft identity is required.");
      return;
    }
    const actor = await database.findActiveUserByMicrosoftIdentity(identity.data.tenantId, identity.data.subject, identity.data.objectId);
    if (!actor) {
      jsonError(response, 403, "neural_labs_access_required", "This Microsoft identity does not have active Neural Labs access.");
      return;
    }
    try {
      if (request.params.operation === "list-channels") {
        response.json({ channels: await collaboration.listChannels(actor) });
        return;
      }
      if (request.params.operation === "directory") {
        response.json({ users: await collaboration.directory() });
        return;
      }
      if (request.params.operation === "list-messages") {
        const parsed = z.object({ channelId: z.string().uuid(), before: z.number().int().positive().optional(), limit: z.number().int().min(1).max(TEAM_CHAT_LIMITS.messagesPerPage).default(TEAM_CHAT_LIMITS.messagesPerPage) }).safeParse(request.body);
        if (!parsed.success) throw new CollaborationError(422, "invalid_arguments", "Provide a valid channel and message cursor.");
        response.json({ messages: await collaboration.listMessages(actor, parsed.data.channelId, parsed.data.before, parsed.data.limit) });
        return;
      }
      if (request.params.operation === "list-members") {
        const parsed = z.object({ channelId: z.string().uuid() }).safeParse(request.body);
        if (!parsed.success) throw new CollaborationError(422, "invalid_arguments", "Provide a valid channel.");
        response.json({ users: await collaboration.members(actor, parsed.data.channelId) });
        return;
      }
      if (request.params.operation === "create-channel") {
        const parsed = teamChannelSchema.pick({ name: true, audience: true, memberIds: true }).safeParse(request.body);
        if (!parsed.success) throw new CollaborationError(422, "invalid_arguments", "Provide a channel name, audience, and valid members.");
        const created = await collaboration.createChannel(actor, parsed.data);
        await database.audit(actor.id, "team.channel_created_via_mcp", null, { channelId: created.channel.id, audience: created.channel.audience });
        publish({ type: "channels.changed", channelId: created.channel.id });
        response.status(201).json(created);
        return;
      }
      if (request.params.operation === "post-message") {
        const parsed = teamMessageSchema.extend({ channelId: z.string().uuid() }).safeParse(request.body);
        if (!parsed.success) throw new CollaborationError(422, "invalid_arguments", "Provide a valid channel message.");
        const posted = await collaboration.postMessage(actor, parsed.data);
        publish({ type: "message.created", channelId: parsed.data.channelId, message: posted.message });
        publish({ type: "channels.changed", channelId: parsed.data.channelId });
        if (posted.run) input.onAgentRun?.(posted.run);
        response.status(201).json({ message: posted.message });
        return;
      }
      jsonError(response, 404, "operation_not_found", "Unknown Team Chat operation.");
    } catch (error) {
      if (error instanceof CollaborationError) {
        jsonError(response, error.status, error.code, error.message);
        return;
      }
      throw error;
    }
  });

  app.post("/internal/team-mcp", async (request, response) => {
    const capability = request.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!capability) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    let capabilityChannel: Awaited<ReturnType<CollaborationStore["channelForCapability"]>>;
    try {
      capabilityChannel = await collaboration.channelForCapability(capability);
    } catch {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    const rpc = z.object({
      jsonrpc: z.literal("2.0"),
      id: z.union([z.string(), z.number(), z.null()]).optional(),
      method: z.string(),
      params: z.unknown().optional(),
    }).safeParse(request.body);
    if (!rpc.success) {
      response.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
      return;
    }
    const id = rpc.data.id ?? null;
    const result = (value: unknown) => response.json({ jsonrpc: "2.0", id, result: value });
    const toolResult = (value: unknown) => result({
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value,
    });
    try {
      if (rpc.data.method === "initialize") {
        const protocolVersion = z.object({ protocolVersion: z.string() }).safeParse(rpc.data.params);
        result({
          protocolVersion: protocolVersion.success ? protocolVersion.data.protocolVersion : "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "neural-labs-team", version: "0.3.2" },
          instructions: "These tools are capability-scoped to the Team Chat that invoked Neura. They cannot access another channel.",
        });
        return;
      }
      if (rpc.data.method === "notifications/initialized" || rpc.data.method === "notifications/cancelled") {
        response.status(202).end();
        return;
      }
      if (rpc.data.method === "ping") {
        result({});
        return;
      }
      if (rpc.data.method === "tools/list") {
        result({ tools: [
          {
            name: "neural_labs_channel_info",
            title: "Show current Team Chat",
            description: "Show the current Team Chat and its members. This capability cannot inspect another channel.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
          },
          {
            name: "neural_labs_list_channel_messages",
            title: "Read current Team Chat messages",
            description: "Read recent messages in the current Team Chat only.",
            inputSchema: {
              type: "object",
              properties: {
                before: { type: "integer", minimum: 1 },
                limit: { type: "integer", minimum: 1, maximum: TEAM_CHAT_LIMITS.messagesPerPage, default: TEAM_CHAT_LIMITS.messagesPerPage },
              },
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
          },
          {
            name: "neural_labs_post_channel_message",
            title: "Post to current Team Chat",
            description: "Post a Neura message and shared-workspace file or image attachments in the current Team Chat only. Attachment paths must be relative to the shared workspace.",
            inputSchema: {
              type: "object",
              properties: {
                body: { type: "string", maxLength: TEAM_CHAT_LIMITS.messageCharacters },
                attachments: {
                  type: "array",
                  maxItems: TEAM_CHAT_LIMITS.attachmentsPerMessage,
                  items: {
                    type: "object",
                    properties: {
                      path: { type: "string", minLength: 1, maxLength: 4096, description: "Path relative to the shared workspace root." },
                      name: { type: "string", minLength: 1, maxLength: 255 },
                      type: { type: "string", maxLength: 200, description: "MIME type, such as image/png or application/pdf." },
                      size: { type: "integer", minimum: 0 },
                    },
                    required: ["path", "name"],
                    additionalProperties: false,
                  },
                },
              },
              anyOf: [
                { required: ["body"] },
                { required: ["attachments"] },
              ],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
          },
        ] });
        return;
      }
      if (rpc.data.method === "tools/call") {
        const call = z.object({ name: z.string(), arguments: z.unknown().optional() }).safeParse(rpc.data.params);
        if (!call.success) throw new CollaborationError(422, "invalid_tool_call", "Invalid Team Chat tool call.");
        if (call.data.name === "neural_labs_channel_info") {
          toolResult(capabilityChannel);
          return;
        }
        if (call.data.name === "neural_labs_list_channel_messages") {
          const args = z.object({ before: z.number().int().positive().optional(), limit: z.number().int().min(1).max(TEAM_CHAT_LIMITS.messagesPerPage).default(TEAM_CHAT_LIMITS.messagesPerPage) }).safeParse(call.data.arguments ?? {});
          if (!args.success) throw new CollaborationError(422, "invalid_tool_arguments", "Invalid message list arguments.");
          toolResult({ messages: await collaboration.messagesForCapability(capability, args.data.before, args.data.limit) });
          return;
        }
        if (call.data.name === "neural_labs_post_channel_message") {
          const args = z.object({
            body: z.string().trim().max(TEAM_CHAT_LIMITS.messageCharacters).default(""),
            attachments: z.array(z.object({
              path: z.string().trim().min(1).max(4096),
              name: z.string().trim().min(1).max(255),
              type: z.string().trim().max(200).optional(),
              size: z.number().int().nonnegative().optional(),
            })).max(TEAM_CHAT_LIMITS.attachmentsPerMessage).default([]),
          }).refine((value) => Boolean(value.body) || value.attachments.length > 0).safeParse(call.data.arguments ?? {});
          if (!args.success) throw new CollaborationError(422, "invalid_tool_arguments", "A message body or workspace attachment is required.");
          const message = await collaboration.postAgentMessage(capability, args.data.body, args.data.attachments);
          publish({ type: "message.created", channelId: message.channelId, message });
          publish({ type: "channels.changed", channelId: message.channelId });
          toolResult({ message });
          return;
        }
        response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown Team Chat tool" } });
        return;
      }
      response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    } catch (error) {
      const message = error instanceof CollaborationError ? error.message : "Team Chat tool failed";
      response.json({ jsonrpc: "2.0", id, error: { code: -32602, message } });
    }
  });

  app.get("/internal/mcp/config", async (request, response) => {
    const supplied = request.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!supplied || !safeEqual(supplied, config.mcpConfigToken)) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    const stored = await database.getInstanceConfig();
    const origin = authConfiguration.effectivePublicOrigin(stored);
    if (!origin) {
      response.status(503).json({ status: "unconfigured" });
      return;
    }
    const mcpConfig = await database.getMcpRuntimeConfig(origin.origin);
    if (!mcpConfig) {
      response.status(503).json({ status: "unconfigured", version: stored.configVersion });
      return;
    }
    response.json(mcpConfig);
  });

  app.post("/internal/turn-credentials", (request, response) => {
    const supplied = request.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!supplied || !safeEqual(supplied, config.workspace.controlToken)) {
      response.status(401).json({ error: { code: "unauthorized", message: "Unauthorized" } });
      return;
    }
    if (!config.turn) {
      response.status(503).json({ error: { code: "turn_unavailable", message: "TURN is not configured" } });
      return;
    }
    const parsed = z.object({ actorId: z.string().trim().min(1).max(256) }).safeParse(request.body);
    if (!parsed.success) {
      jsonError(response, 422, "invalid_actor", "A valid workspace actor is required");
      return;
    }
    const expiresAt = Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL_SECONDS;
    const actorKey = createHash("sha256").update(parsed.data.actorId).digest("hex").slice(0, 20);
    const username = `${expiresAt}:${actorKey}`;
    const credential = createHmac("sha1", config.turn.secret).update(username).digest("base64");
    const stunUrls = config.turn.urls.filter((url) => url.startsWith("stun:")).map((url) => ({ urls: [url] }));
    const relayUrls = config.turn.urls.filter((url) => url.startsWith("turn:") || url.startsWith("turns:"));
    response.json({
      iceServers: [...stunUrls, ...(relayUrls.length > 0 ? [{ urls: relayUrls, username, credential }] : [])],
      expiresAt,
    });
  });

  app.post("/internal/team-terminal/access", async (request, response) => {
    const supplied = request.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!supplied || !safeEqual(supplied, config.workspace.controlToken)) {
      response.status(401).json({ error: { code: "unauthorized", message: "Unauthorized" } });
      return;
    }
    const parsed = z.object({
      actorId: z.string().trim().min(1).max(256),
      channelId: z.string().uuid(),
    }).safeParse(request.body);
    if (!parsed.success) {
      jsonError(response, 422, "invalid_team_terminal_access", "A valid workspace actor and Team Chat channel are required");
      return;
    }
    const access = await collaboration.teamTerminalAccess(parsed.data.channelId, parsed.data.actorId);
    response.json(access ?? { allowed: false });
  });

  app.get("/internal/workspace/auth", async (request, response) => {
    const actor = await sessions.actor(request);
    if (!actor) {
      response.setHeader("X-Neural-Labs-Redirect", "/login?error=Please+log+in");
      response.status(401).end();
      return;
    }
    if (actor.user.status !== "active") {
      response.setHeader("X-Neural-Labs-Redirect", redirectForActor(actor));
      response.status(401).end();
      return;
    }
    response.setHeader("X-Neural-Labs-User", actor.user.id);
    response.setHeader("X-Neural-Labs-Email", actor.user.email);
    response.setHeader("X-Neural-Labs-Role", actor.user.role);
    response.status(204).end();
  });

  app.get("/internal/workspace/admin-auth", async (request, response) => {
    const actor = await sessions.actor(request);
    if (!actor) {
      response.setHeader("X-Neural-Labs-Redirect", "/login?error=Please+log+in");
      response.status(401).end();
      return;
    }
    if (actor.user.status !== "active") {
      response.setHeader("X-Neural-Labs-Redirect", redirectForActor(actor));
      response.status(401).end();
      return;
    }
    if (actor.user.role !== "admin") {
      response.status(403).end();
      return;
    }
    response.setHeader("X-Neural-Labs-User", actor.user.id);
    response.setHeader("X-Neural-Labs-Email", actor.user.email);
    response.setHeader("X-Neural-Labs-Role", actor.user.role);
    response.status(204).end();
  });

  app.get("/workspace", async (request, response) => {
    const actor = await requireActive(request, response);
    if (!actor) return;
    sendConsole(response);
  });

  app.get(/^\/admin(?:\/.*)?$/, async (request, response) => {
    const actor = await sessions.actor(request);
    if (!actor) {
      response.redirect(303, "/login?error=Please+log+in");
      return;
    }
    if (actor.user.status !== "active") {
      response.redirect(303, redirectForActor(actor));
      return;
    }
    response.redirect(303, "/workspace");
  });

  app.use((request, response) => {
    if (request.path.startsWith("/api/")) {
      jsonError(response, 404, "not_found", "The requested API endpoint does not exist.");
    } else {
      handleError(response, 404, "Not found", "The requested control-plane page does not exist.");
    }
  });

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    console.error("Unhandled control-plane error", error);
    if (!response.headersSent) {
      if ((error as { status?: number }).status === 413) {
        if (request.path.startsWith("/api/")) {
          jsonError(response, 413, "payload_too_large", "The request is too large.");
        } else {
          handleError(response, 413, "Request too large", "The request is too large.");
        }
        return;
      }
      if (request.path.startsWith("/api/")) {
        jsonError(response, 500, "internal_error", "The control plane could not complete the request.");
      } else {
        handleError(response, 500, "Internal error", "The control plane could not complete the request.");
      }
    }
  });

  return { app, sessions, collaboration };
}
