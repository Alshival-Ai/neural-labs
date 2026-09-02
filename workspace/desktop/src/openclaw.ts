import {
  GatewayBrowserDeviceAuthLifecycle,
  GatewayProtocolClient,
  getGatewaySessionMessageSubscriptionCoordinator,
  releaseGatewaySessionMessageSubscription,
  resetGatewaySessionMessageSubscriptionCoordinator,
  type GatewayBrowserDeviceAuthPlan,
  type GatewayBrowserDeviceIdentity,
  type GatewayBrowserDeviceTokenRecord,
  type GatewayProtocolSocketHandlers,
  type GatewaySessionMessageSubscription,
} from "@openclaw/gateway-client/browser";
import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
} from "@openclaw/gateway-protocol/client-info";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";

import type {
  ComposerAttachment,
  ConnectionState,
  GatewayEvent,
  NeuraMessage,
  SessionRow,
} from "./types";
import { buildSessionDeletionPlan } from "./sessionDeletion";
import {
  PRIVATE_NEURA_SESSION,
  shouldIncludeNeuraSession,
  shouldProtectLegacyPrivateSession,
} from "./sessionVisibility";

const AGENT_ID = "main";
const CLIENT_VERSION = "0.1.0";
const IDENTITY_KEY = "neural-labs.neura.device.v1";
const TOKEN_PREFIX = "neural-labs.neura.token.v1";
const INSTANCE_KEY = "neural-labs.neura.instance.v1"; // gitleaks:allow -- localStorage key name, not a credential
const SCOPES = ["operator.read", "operator.write", "operator.approvals", "operator.questions"] as const;

type StoredIdentity = { privateKey: string; publicKey: string; deviceId: string };
type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function standardBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createStoredIdentity(): Promise<StoredIdentity> {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const privateKey = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const deviceId = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", publicKey)));
  return { privateKey: base64Url(privateKey), publicKey: base64Url(publicKey), deviceId };
}

async function loadIdentity(): Promise<GatewayBrowserDeviceIdentity | null> {
  try {
    const storedValue = localStorage.getItem(IDENTITY_KEY);
    const stored = storedValue ? (JSON.parse(storedValue) as StoredIdentity) : await createStoredIdentity();
    if (!storedValue) localStorage.setItem(IDENTITY_KEY, JSON.stringify(stored));
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      fromBase64Url(stored.privateKey),
      "Ed25519",
      false,
      ["sign"],
    );
    return {
      deviceId: stored.deviceId,
      publicKey: stored.publicKey,
      sign: async (payload) => {
        const signature = await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(payload));
        return base64Url(new Uint8Array(signature));
      },
    };
  } catch (error) {
    console.warn("Neura could not initialize browser device identity", error);
    return null;
  }
}

function tokenStorageKey(clientId: string, deviceId: string, role: string): string {
  return `${TOKEN_PREFIX}:${clientId}:${deviceId}:${role}`;
}

const tokenStore = {
  load({ clientId, deviceId, role }: { clientId: string; deviceId: string; role: string }) {
    try {
      const value = localStorage.getItem(tokenStorageKey(clientId, deviceId, role));
      return value ? (JSON.parse(value) as GatewayBrowserDeviceTokenRecord) : null;
    } catch {
      return null;
    }
  },
  store(params: { clientId: string; deviceId: string; role: string; token: string; scopes: string[] }) {
    localStorage.setItem(
      tokenStorageKey(params.clientId, params.deviceId, params.role),
      JSON.stringify({ token: params.token, scopes: params.scopes }),
    );
  },
  clear({ clientId, deviceId, role }: { clientId: string; deviceId: string; role: string }) {
    localStorage.removeItem(tokenStorageKey(clientId, deviceId, role));
  },
};

function instanceId(): string {
  const existing = localStorage.getItem(INSTANCE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(INSTANCE_KEY, created);
  return created;
}

function socketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/workspace/neura/socket`;
}

function createSocket(handlers: GatewayProtocolSocketHandlers) {
  const socket = new WebSocket(socketUrl());
  socket.addEventListener("open", handlers.open);
  socket.addEventListener("message", (event) => handlers.message(String(event.data)));
  socket.addEventListener("close", (event) => handlers.close(event.code, event.reason));
  socket.addEventListener("error", () => handlers.error(new Error("Neura Gateway connection failed")));
  return {
    isOpen: () => socket.readyState === WebSocket.OPEN,
    send: (data: string) => socket.send(data),
    close: (code?: number, reason?: string) => socket.close(code, reason),
  };
}

const clientInfo = {
  id: GATEWAY_CLIENT_IDS.WEBCHAT_UI,
  displayName: "Neura",
  version: CLIENT_VERSION,
  platform: "web",
  deviceFamily: "browser",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  mode: GATEWAY_CLIENT_MODES.UI,
  instanceId: instanceId(),
} as const;

export class NeuraGateway {
  private readonly lifecycle = new GatewayBrowserDeviceAuthLifecycle({ loadIdentity, tokenStore });
  private readonly statusListeners = new Set<(state: ConnectionState, error?: string) => void>();
  private readonly eventListeners = new Set<(event: GatewayEvent) => void>();
  private readonly client: GatewayProtocolClient<GatewayBrowserDeviceAuthPlan>;
  private started = false;
  private currentStatus: ConnectionState = "disconnected";
  private currentError?: string;

  constructor() {
    this.client = new GatewayProtocolClient({
      createSocket,
      createRequestId: () => crypto.randomUUID(),
      buildConnectPlan: ({ nonce, challengeTs }) =>
        this.lifecycle.buildPlan({
          client: clientInfo,
          role: "operator",
          defaultScopes: SCOPES,
          nonce,
          challengeTs,
        }),
      buildConnectParams: (plan) => ({
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: clientInfo,
        caps: [
          GATEWAY_CLIENT_CAPS.TOOL_EVENTS,
          GATEWAY_CLIENT_CAPS.APPROVALS,
          GATEWAY_CLIENT_CAPS.EXEC_APPROVALS,
          GATEWAY_CLIENT_CAPS.PLUGIN_APPROVALS,
          GATEWAY_CLIENT_CAPS.SESSION_SCOPED_EVENTS,
        ],
        role: "operator",
        scopes: plan.scopes,
        device: plan.device,
        auth: plan.auth,
        locale: navigator.language,
        userAgent: navigator.userAgent,
      }),
      onConnectHello: (hello, context) => void this.lifecycle.acceptHello(hello, context.plan),
      onHello: () => this.setStatus("connected"),
      onConnectFailure: (error) => ({
        closeCode: 4003,
        closeReason: "Gateway rejected the Neura connection",
        error,
        reconnectDelayMs: 4_000,
      }),
      resolveClose: ({ code, connectFailure }) => ({
        retry: code !== 1000,
        notify: true,
        reconnectDelayMs: connectFailure?.reconnectDelayMs,
        pendingError: connectFailure?.error,
      }),
      onClose: (context) => {
        resetGatewaySessionMessageSubscriptionCoordinator(this.client);
        if (context.code !== 1000) this.setStatus("disconnected", context.connectFailure?.error.message);
      },
      onConnectError: (error) => this.setStatus("error", error.message),
      onSocketFactoryError: (error) => this.setStatus("error", error.message),
      onEvent: (event) => {
        const normalized = { event: event.event, payload: event.payload };
        for (const listener of this.eventListeners) listener(normalized);
      },
      handshake: { mode: "require-challenge", timeoutMs: 15_000 },
      reconnect: { initialMs: 1_000, multiplier: 2, maxMs: 30_000 },
    });
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.setStatus("connecting");
    this.client.start();
  }

  stop() {
    this.started = false;
    resetGatewaySessionMessageSubscriptionCoordinator(this.client);
    this.client.stop();
  }

  onStatus(listener: (state: ConnectionState, error?: string) => void) {
    this.statusListeners.add(listener);
    listener(this.currentStatus, this.currentError);
    return () => this.statusListeners.delete(listener);
  }

  onEvent(listener: (event: GatewayEvent) => void) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private setStatus(state: ConnectionState, error?: string) {
    this.currentStatus = state;
    this.currentError = error;
    for (const listener of this.statusListeners) listener(state, error);
  }

  async listSessions(): Promise<SessionRow[]> {
    const params = {
      limit: 200,
      agentId: AGENT_ID,
      archived: "all",
      ownerFirst: true,
      includeDerivedTitles: true,
      includeLastMessage: true,
    };
    const result = await this.client.request<unknown>("sessions.list", params);
    // The subscription acknowledgement is not a session-list response. Keep
    // roster events enabled, but never use its (often empty) payload as data.
    void this.client.request("sessions.subscribe", params).catch(() => undefined);
    const rows = isRecord(result) && Array.isArray(result.sessions) ? result.sessions : [];
    return rows.flatMap((value, index): SessionRow[] => {
      if (!isRecord(value) || !shouldIncludeNeuraSession(value, AGENT_ID)) return [];
      const key = stringValue(value.key) ?? stringValue(value.sessionKey);
      if (!key) return [];
      const category = stringValue(value.category);
      const title =
        stringValue(value.label) ??
        stringValue(value.derivedTitle) ??
        stringValue(value.title) ??
        stringValue(value.lastMessage) ??
        `Conversation ${index + 1}`;
      const updatedAt = numberValue(value.updatedAt) ?? numberValue(value.updatedAtMs) ?? Date.now();
      const rawVisibility = stringValue(value.visibility);
      const visibility = ["shared", "read-only", "suggest", "draft"].includes(rawVisibility ?? "")
        ? rawVisibility as SessionRow["visibility"]
        : "shared";
      const rawSharingRole = stringValue(value.sharingRole);
      const sharingRole = ["admin", "owner", "member", "viewer"].includes(rawSharingRole ?? "")
        ? rawSharingRole as NonNullable<SessionRow["sharingRole"]>
        : undefined;
      return [{
        key,
        sessionId: stringValue(value.sessionId),
        title,
        updatedAt,
        archived: value.archived === true || Boolean(value.archivedAt),
        active: value.hasActiveRun === true || (Array.isArray(value.activeRunIds) && value.activeRunIds.length > 0),
        category,
        visibility,
        sharingRole,
      }];
    });
  }

  async protectLegacyPrivateSessions(sessions: SessionRow[]): Promise<SessionRow[]> {
    const legacyOwnedSessions = sessions.filter(shouldProtectLegacyPrivateSession);
    if (legacyOwnedSessions.length === 0) return sessions;

    const outcomes = await Promise.allSettled(legacyOwnedSessions.map((session) =>
      this.client.request("session.visibility.set", {
        sessionKey: session.key,
        agentId: AGENT_ID,
        visibility: "draft",
      })));
    const protectedKeys = new Set(legacyOwnedSessions.flatMap((session, index) =>
      outcomes[index]?.status === "fulfilled" ? [session.key] : []));
    return sessions.map((session) => protectedKeys.has(session.key)
      ? { ...session, visibility: "draft" as const }
      : session);
  }

  subscribeSession(sessionKey: string): Promise<GatewaySessionMessageSubscription> {
    return getGatewaySessionMessageSubscriptionCoordinator(this.client).acquire(sessionKey, {
      agentId: AGENT_ID,
      includeApprovals: true,
    });
  }

  unsubscribeSession(subscription: GatewaySessionMessageSubscription): Promise<void> {
    return releaseGatewaySessionMessageSubscription(subscription);
  }

  async createSession(): Promise<SessionRow> {
    const label = "New conversation";
    const result = await this.client.request<unknown>("sessions.create", {
      idempotencyKey: crypto.randomUUID(),
      agentId: AGENT_ID,
      ...PRIVATE_NEURA_SESSION,
    });
    if (!isRecord(result) || !stringValue(result.key)) throw new Error("OpenClaw did not return a session key");
    return {
      key: stringValue(result.key)!,
      sessionId: stringValue(result.sessionId),
      title: label,
      updatedAt: Date.now(),
      archived: false,
      active: false,
      ...PRIVATE_NEURA_SESSION,
      sharingRole: "owner",
    };
  }

  async loadHistory(sessionKey: string): Promise<NeuraMessage[]> {
    const result = await this.client.request<unknown>("chat.history", {
      sessionKey,
      agentId: AGENT_ID,
      limit: 250,
    });
    const rows = isRecord(result) && Array.isArray(result.messages) ? result.messages : [];
    return rows.flatMap((message, index) => normalizeMessage(message, `${sessionKey}:${index}`));
  }

  async send(
    session: SessionRow,
    message: string,
    attachments: ComposerAttachment[],
    queueMode: "steer" | "followup",
  ) {
    return this.client.request<{ runId?: string }>("chat.send", {
      sessionKey: session.key,
      sessionId: session.sessionId,
      agentId: AGENT_ID,
      message,
      attachments: await Promise.all(attachments.map(fileToGatewayAttachment)),
      queueMode,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  abort(sessionKey: string, runId?: string) {
    return this.client.request("chat.abort", { sessionKey, agentId: AGENT_ID, runId });
  }

  patchSession(session: SessionRow, patch: { label?: string; archived?: boolean }) {
    return this.client.request("sessions.patch", {
      key: session.key,
      agentId: AGENT_ID,
      expectedSessionId: session.sessionId,
      ...patch,
    });
  }

  async deleteSession(session: SessionRow) {
    const plan = buildSessionDeletionPlan(session);
    if (plan.archive) await this.client.request("sessions.patch", plan.archive);
    return this.client.request("sessions.delete", plan.remove);
  }

  resolveApproval(id: string, kind: string, decision: string) {
    return this.client.request("approval.resolve", { id, kind, decision });
  }

  readSkillsStatus() {
    return this.client.request<unknown>("skills.status", { agentId: AGENT_ID });
  }

  readSkillsCuratorStatus() {
    return this.client.request<unknown>("skills.curator.status", {});
  }

  readSkillCard(skillKey: string) {
    return this.client.request<unknown>("skills.skillCard", { agentId: AGENT_ID, skillKey });
  }

  searchSkills(query: string) {
    const normalized = query.trim();
    if (!normalized) return Promise.resolve<unknown>({ results: [] });
    return this.client.request<unknown>("skills.search", { query: normalized, limit: 24 });
  }

  readSkillDetail(slug: string) {
    return this.client.request<unknown>("skills.detail", { slug });
  }

  listSkillProposals() {
    return this.client.request<unknown>("skills.proposals.list", { agentId: AGENT_ID });
  }

  inspectSkillProposal(proposalId: string) {
    return this.client.request<unknown>("skills.proposals.inspect", { agentId: AGENT_ID, proposalId });
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      return stringValue(part.text) ?? stringValue(part.content) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeMessage(value: unknown, fallbackId: string): NeuraMessage[] {
  if (!isRecord(value)) return [];
  const rawRole = stringValue(value.role) ?? (isRecord(value.message) ? stringValue(value.message.role) : undefined);
  if (!rawRole || !["user", "assistant", "system"].includes(rawRole)) return [];
  const nested = isRecord(value.message) ? value.message : value;
  const text = textFromContent(nested.content) || stringValue(nested.text) || stringValue(value.text) || "";
  if (!text) return [];
  return [{
    id: stringValue(value.id) ?? stringValue(nested.id) ?? fallbackId,
    role: rawRole as NeuraMessage["role"],
    text,
  }];
}

async function fileToGatewayAttachment(attachment: ComposerAttachment) {
  const bytes = new Uint8Array(await attachment.file.arrayBuffer());
  return {
    type: attachment.file.type.startsWith("image/") ? "image" : "file",
    mimeType: attachment.file.type || "application/octet-stream",
    fileName: attachment.file.name,
    content: standardBase64(bytes),
    sizeBytes: attachment.file.size,
  };
}

export function eventRecord(event: GatewayEvent): RecordValue | null {
  return isRecord(event.payload) ? event.payload : null;
}

export function eventText(value: unknown): string {
  if (!isRecord(value)) return "";
  return textFromContent(value.content) || stringValue(value.text) || "";
}

export function messagesFromSessionEvent(event: GatewayEvent) {
  const payload = eventRecord(event);
  if (event.event !== "session.message" || !payload) return null;
  const sessionKey = stringValue(payload.sessionKey);
  if (!sessionKey) return null;
  const runId = stringValue(payload.clientRunId) ?? stringValue(payload.runId);
  const sequence = numberValue(payload.messageSeq);
  const fallbackId = stringValue(payload.messageId) ?? `${sessionKey}:${sequence ?? crypto.randomUUID()}`;
  return {
    sessionKey,
    runId,
    phase: stringValue(payload.phase),
    messages: normalizeMessage(payload.message, fallbackId),
  };
}
