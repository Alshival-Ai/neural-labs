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

import { mapAutomationsSnapshot, type AutomationsSnapshot } from "./automationsGateway";
import type {
  ComposerAttachment,
  ConnectionState,
  GatewayEvent,
  NeuraActivity,
  NeuraMessage,
  SessionRow,
} from "./types";
import { buildSessionDeletionPlan } from "./sessionDeletion";
import {
  PRIVATE_NEURA_SESSION,
  shouldIncludeNeuraSession,
  shouldProtectLegacyPrivateSession,
} from "./sessionVisibility";

const CLIENT_VERSION = "0.3.2";
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
  private startRequested = false;
  private started = false;
  private currentStatus: ConnectionState = "disconnected";
  private currentError?: string;
  private agentId?: string;

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
    this.startRequested = true;
    if (!this.agentId) {
      this.setStatus("connecting");
      return;
    }
    this.startClient();
  }

  private startClient() {
    if (this.started || !this.agentId) return;
    this.started = true;
    this.setStatus("connecting");
    this.client.start();
  }

  setAgentId(agentId: string) {
    if (!/^nl-[a-z0-9]{1,60}$/u.test(agentId)) throw new Error("The Neura agent id is invalid");
    if (this.agentId === agentId) {
      if (this.startRequested) this.startClient();
      return;
    }
    if (this.started) {
      this.started = false;
      resetGatewaySessionMessageSubscriptionCoordinator(this.client);
      this.client.stop();
    }
    this.agentId = agentId;
    if (this.startRequested) this.startClient();
  }

  stop() {
    this.startRequested = false;
    if (!this.started) return;
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

  private requireAgentId(): string {
    if (!this.agentId) throw new Error("The personal Neura agent is still starting");
    return this.agentId;
  }

  async listSessions(): Promise<SessionRow[]> {
    const agentId = this.requireAgentId();
    const params = {
      limit: 200,
      agentId,
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
      if (!isRecord(value) || !shouldIncludeNeuraSession(value, agentId)) return [];
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

  async readAutomations(): Promise<AutomationsSnapshot> {
    const [status, listed, history] = await Promise.all([
      this.client.request<unknown>("cron.status", {}),
      this.client.request<unknown>("cron.list", { includeDisabled: true, limit: 200, sortBy: "updatedAtMs", sortDir: "desc" }),
      this.client.request<unknown>("cron.runs", { scope: "all", limit: 200, sortDir: "desc" }),
    ]);
    return mapAutomationsSnapshot(status, listed, history, true);
  }

  async protectLegacyPrivateSessions(sessions: SessionRow[]): Promise<SessionRow[]> {
    const agentId = this.requireAgentId();
    const legacyOwnedSessions = sessions.filter(shouldProtectLegacyPrivateSession);
    if (legacyOwnedSessions.length === 0) return sessions;

    const outcomes = await Promise.allSettled(legacyOwnedSessions.map((session) =>
      this.client.request("session.visibility.set", {
        sessionKey: session.key,
        agentId,
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
      agentId: this.requireAgentId(),
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
      agentId: this.requireAgentId(),
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
      agentId: this.requireAgentId(),
      limit: 250,
    });
    const rows = isRecord(result) && Array.isArray(result.messages) ? result.messages : [];
    return normalizeNeuraHistory(rows, sessionKey);
  }

  async send(
    session: SessionRow,
    message: string,
    attachments: ComposerAttachment[],
    queueMode: "steer" | "followup",
  ) {
    return this.client.request<{ runId: string }>("chat.send", {
      sessionKey: session.key,
      sessionId: session.sessionId,
      agentId: this.requireAgentId(),
      message,
      attachments: await Promise.all(attachments.map(fileToGatewayAttachment)),
      queueMode,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  abort(sessionKey: string, runId?: string) {
    return this.client.request("chat.abort", { sessionKey, agentId: this.requireAgentId(), runId });
  }

  patchSession(session: SessionRow, patch: { label?: string; archived?: boolean }) {
    return this.client.request("sessions.patch", {
      key: session.key,
      agentId: this.requireAgentId(),
      expectedSessionId: session.sessionId,
      ...patch,
    });
  }

  async deleteSession(session: SessionRow) {
    const plan = buildSessionDeletionPlan(session, this.requireAgentId());
    if (plan.archive) await this.client.request("sessions.patch", plan.archive);
    return this.client.request("sessions.delete", plan.remove);
  }

  resolveApproval(id: string, kind: string, decision: string) {
    return this.client.request("approval.resolve", { id, kind, decision });
  }

  readSkillsStatus() {
    return this.client.request<unknown>("skills.status", { agentId: this.requireAgentId() });
  }

  readSkillsCuratorStatus() {
    return this.client.request<unknown>("skills.curator.status", {});
  }

  readSkillCard(skillKey: string) {
    return this.client.request<unknown>("skills.skillCard", { agentId: this.requireAgentId(), skillKey });
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
    return this.client.request<unknown>("skills.proposals.list", { agentId: this.requireAgentId() });
  }

  inspectSkillProposal(proposalId: string) {
    return this.client.request<unknown>("skills.proposals.inspect", { agentId: this.requireAgentId(), proposalId });
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const ACTIVITY_SECRET_ASSIGNMENT = /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|password|passwd|secret|authorization)\b(\s*[:=]\s*)([^\s,;]+)/gi;
const ACTIVITY_BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+/gi;
const ACTIVITY_OPENAI_KEY = /\bsk-[A-Za-z0-9_-]{12,}\b/g;

function safeActivityText(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value : "";
  return text
    .replace(ACTIVITY_BEARER, "Bearer [redacted]")
    .replace(ACTIVITY_OPENAI_KEY, "[redacted]")
    .replace(ACTIVITY_SECRET_ASSIGNMENT, (_match, name: string, separator: string) => `${name}${separator}[redacted]`)
    .trim()
    .slice(0, limit);
}

function nestedActivityText(value: unknown, limit: number): string {
  if (typeof value === "string") return safeActivityText(value, limit);
  if (Array.isArray(value)) {
    return safeActivityText(value.map((item) => nestedActivityText(item, limit)).filter(Boolean).join("\n"), limit);
  }
  if (!isRecord(value)) return "";
  return nestedActivityText(value.output ?? value.text ?? value.content ?? value.message, limit);
}

function activityState(data: RecordValue): NeuraActivity["state"] {
  const value = (stringValue(data.status) ?? stringValue(data.state) ?? stringValue(data.phase) ?? "running").toLowerCase();
  if (["error", "failed", "failure"].includes(value) || data.isError === true) return "error";
  if (["done", "completed", "complete", "result", "end", "success", "succeeded"].includes(value)) return "done";
  return "running";
}

function activityArguments(data: RecordValue): RecordValue {
  for (const value of [data.args, data.arguments, data.input]) {
    if (isRecord(value)) return value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (isRecord(parsed)) return parsed;
      } catch {
        // A plain string is not a structured tool argument object.
      }
    }
  }
  return {};
}

function activityCommand(args: RecordValue): string {
  const value = args.command ?? args.cmd;
  return safeActivityText(Array.isArray(value) ? value.map(String).join(" ") : value, 4_000);
}

function activityPlan(data: RecordValue, args: RecordValue): string {
  const value = Array.isArray(data.plan) ? data.plan : Array.isArray(data.steps) ? data.steps : Array.isArray(args.plan) ? args.plan : Array.isArray(args.steps) ? args.steps : [];
  const steps = value.slice(0, 20).map((candidate) => {
    if (typeof candidate === "string") return safeActivityText(candidate, 240);
    if (!isRecord(candidate)) return "";
    const text = safeActivityText(candidate.step ?? candidate.title ?? candidate.text, 240);
    const status = safeActivityText(candidate.status, 40).replaceAll("_", " ");
    return text ? `${status ? `${status}: ` : ""}${text}` : "";
  }).filter(Boolean);
  return safeActivityText(steps.join("\n") || (data.explanation ?? args.explanation), 3_000);
}

function activityForTool(data: RecordValue, sessionKey: string, runId?: string): NeuraActivity | null {
  const args = activityArguments(data);
  const result = isRecord(data.result) ? data.result : {};
  const resultDetails = isRecord(result.details) ? result.details : {};
  const name = (stringValue(data.name) ?? stringValue(data.toolName) ?? stringValue(data.tool) ?? "tool").toLowerCase();
  const toolCallId = stringValue(data.toolCallId) ?? stringValue(data.tool_call_id) ?? stringValue(data.callId) ?? stringValue(data.id);
  if (!toolCallId) return null;
  const state = activityState({ ...resultDetails, ...result, ...data });
  const command = activityCommand(args);
  const isCommand = Boolean(command) || /(^|[._-])(exec|bash|shell|command|terminal)([._-]|$)/.test(name);
  const isPlan = name.includes("plan");
  const isFile = /(apply.?patch|write.?file|edit.?file|create.?file)/.test(name);
  const output = nestedActivityText(data.output ?? result.output ?? resultDetails.output, 12_000);
  const detail = safeActivityText(data.summary ?? data.detail ?? data.meta ?? data.toolErrorSummary, 2_400);
  const path = safeActivityText(args.path ?? args.filePath ?? args.file, 600);
  const exitCode = numberValue(data.exitCode) ?? numberValue(result.exitCode) ?? numberValue(resultDetails.exitCode);
  const durationMs = numberValue(data.durationMs) ?? numberValue(result.durationMs) ?? numberValue(resultDetails.durationMs);

  if (isPlan) {
    return { id: `plan:${toolCallId}`, sessionKey, runId, kind: "plan", title: state === "running" ? "Updating plan" : "Plan updated", detail: activityPlan(data, args) || detail, state };
  }
  if (isCommand) {
    return {
      id: `command:${toolCallId}`, sessionKey, runId, kind: "command",
      title: state === "running" ? "Running command" : state === "error" ? "Command failed" : "Command completed",
      ...(command ? { command } : {}), ...(output ? { output } : {}), ...(detail ? { detail } : {}),
      ...(exitCode !== undefined ? { exitCode } : {}), ...(durationMs !== undefined ? { durationMs } : {}), state,
    };
  }
  if (isFile) {
    return { id: `file:${toolCallId}`, sessionKey, runId, kind: "file", title: state === "running" ? "Updating files" : state === "error" ? "File update failed" : "Files updated", ...(path ? { path } : {}), ...(detail ? { detail } : {}), state };
  }
  const readableName = name.replace(/^mcp__/, "").replaceAll(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return { id: `tool:${toolCallId}`, sessionKey, runId, kind: "tool", title: readableName || "Agent action", ...(detail ? { detail } : {}), state };
}

function mergeActivity(list: NeuraActivity[], activity: NeuraActivity): NeuraActivity[] {
  const previous = list.find((item) => item.id === activity.id);
  return [...list.filter((item) => item.id !== activity.id), { ...previous, ...activity }].slice(-80);
}

function foldAssistantProgress(messages: NeuraMessage[], sessionKey: string): NeuraMessage[] {
  const folded: NeuraMessage[] = [];
  for (let index = 0; index < messages.length;) {
    if (messages[index].role !== "assistant") {
      folded.push(messages[index]);
      index += 1;
      continue;
    }
    const group: NeuraMessage[] = [];
    while (index < messages.length && messages[index].role === "assistant") {
      group.push(messages[index]);
      index += 1;
    }
    if (group.length === 1) {
      folded.push(group[0]);
      continue;
    }
    const answerIndex = group.findLastIndex((message) => Boolean(message.text.trim()));
    const answer = group[Math.max(0, answerIndex)];
    const activities: NeuraActivity[] = [];
    for (const [groupIndex, message] of group.entries()) {
      for (const activity of message.activities ?? []) activities.push(activity);
      if (groupIndex !== answerIndex && message.text.trim()) activities.push({
        id: `thinking:${message.id}`,
        sessionKey,
        kind: "thinking",
        title: "Progress update",
        detail: safeActivityText(message.text, 2_400),
        state: "done",
      });
    }
    folded.push({
      ...answer,
      ...(answerIndex < 0 ? { text: "" } : {}),
      ...(activities.length ? { activities } : {}),
    });
  }
  return folded;
}

export function activitiesFromGatewayEvent(event: GatewayEvent): NeuraActivity[] {
  const payload = eventRecord(event);
  if (!payload) return [];
  const sessionKey = stringValue(payload.sessionKey);
  if (!sessionKey) return [];
  const runId = stringValue(payload.runId);
  if (event.event === "session.operation") {
    const operation = stringValue(payload.operation)?.replaceAll(/[_-]+/g, " ") ?? "conversation maintenance";
    const state = activityState(payload);
    return [{
      id: `operation:${stringValue(payload.operationId) ?? operation}`,
      sessionKey, runId, kind: "operation",
      title: `${state === "running" ? "Running" : state === "error" ? "Failed" : "Completed"} ${operation}`,
      detail: safeActivityText(payload.reason, 2_400), state,
    }];
  }
  if (event.event !== "session.tool" && event.event !== "agent") return [];
  const stream = (stringValue(payload.stream) ?? "tool").toLowerCase();
  const data = isRecord(payload.data) ? payload.data : payload;
  if (stream === "thinking") {
    return [{ id: `thinking:${runId ?? "active"}`, sessionKey, runId, kind: "thinking", title: "Thinking", detail: "Reasoning through the request", state: activityState(data) }];
  }
  if (stream === "assistant" && stringValue(data.phase) === "commentary") {
    const detail = safeActivityText(data.text ?? data.delta, 2_400);
    return detail ? [{ id: `thinking:${stringValue(data.itemId) ?? runId ?? "active"}`, sessionKey, runId, kind: "thinking", title: "Progress update", detail, state: activityState(data) }] : [];
  }
  if (stream === "plan") {
    return [{ id: `plan:${runId ?? "active"}`, sessionKey, runId, kind: "plan", title: "Plan updated", detail: activityPlan(data, {}), state: activityState(data) }];
  }
  if (stream === "command_output") {
    const commandActivity = activityForTool({ ...data, name: data.name ?? "exec", status: data.status ?? data.phase }, sessionKey, runId);
    return commandActivity ? [commandActivity] : [];
  }
  if (stream === "tool" || event.event === "session.tool") {
    const activity = activityForTool(data, sessionKey, runId);
    return activity ? [activity] : [];
  }
  return [];
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      const type = (stringValue(part.type) ?? "").toLowerCase().replaceAll(/[_-]+/g, "");
      if (["thinking", "reasoning", "toolcall", "tooluse", "functioncall", "toolresult", "tooloutput", "functionresult"].includes(type)) return "";
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

function normalizedMessagePhase(value: unknown): "commentary" | "final_answer" | undefined {
  if (!isRecord(value)) return undefined;
  const nested = isRecord(value.message) ? value.message : value;
  const phase = (stringValue(nested.phase) ?? stringValue(value.phase))?.toLowerCase().replaceAll("-", "_");
  return phase === "commentary" || phase === "final_answer" ? phase : undefined;
}

function normalizedHistoryRole(value: RecordValue): string {
  return (stringValue(value.role) ?? (isRecord(value.message) ? stringValue(value.message.role) : undefined) ?? "")
    .toLowerCase().replaceAll(/[_-]+/g, "");
}

function historyBlocks(value: RecordValue): unknown[] {
  const nested = isRecord(value.message) ? value.message : value;
  return Array.isArray(nested.content) ? nested.content : [];
}

function historyBlockType(value: unknown): string {
  return isRecord(value) ? (stringValue(value.type) ?? "").toLowerCase().replaceAll(/[_-]+/g, "") : "";
}

export function normalizeNeuraHistory(rows: unknown[], sessionKey: string): NeuraMessage[] {
  const messages: NeuraMessage[] = [];
  let pending: NeuraActivity[] = [];
  const toolNames = new Map<string, string>();

  const flushPending = () => {
    if (!pending.length) return;
    messages.push({ id: `${sessionKey}:activity:${messages.length}`, role: "assistant", text: "", activities: pending });
    pending = [];
  };

  rows.forEach((candidate, index) => {
    if (!isRecord(candidate)) return;
    const role = normalizedHistoryRole(candidate);
    const blocks = historyBlocks(candidate);
    if (role === "user") flushPending();

    for (const block of blocks) {
      if (!isRecord(block)) continue;
      const type = historyBlockType(block);
      if (["thinking", "reasoning"].includes(type)) {
        pending = mergeActivity(pending, { id: `thinking:${index}`, sessionKey, kind: "thinking", title: "Thinking", detail: "Reasoned through the request", state: "done" });
      }
      if (["toolcall", "tooluse", "functioncall"].includes(type)) {
        const toolCallId = stringValue(block.toolCallId) ?? stringValue(block.tool_call_id) ?? stringValue(block.callId) ?? stringValue(block.id);
        const name = stringValue(block.name) ?? stringValue(block.toolName) ?? stringValue(block.tool_name) ?? "tool";
        if (toolCallId) toolNames.set(toolCallId, name);
        const activity = activityForTool({ ...block, name, status: "running" }, sessionKey);
        if (activity) pending = mergeActivity(pending, activity);
      }
    }

    if (["tool", "toolresult", "function"].includes(role) || blocks.some((block) => ["toolresult", "tooloutput", "functionresult"].includes(historyBlockType(block)))) {
      const resultBlock = blocks.find((block) => ["toolresult", "tooloutput", "functionresult"].includes(historyBlockType(block)) && isRecord(block));
      const source = isRecord(resultBlock) ? resultBlock : candidate;
      const toolCallId = stringValue(source.toolCallId) ?? stringValue(source.tool_call_id) ?? stringValue(source.callId) ?? stringValue(candidate.toolCallId) ?? stringValue(candidate.tool_call_id);
      const name = stringValue(source.name) ?? stringValue(source.toolName) ?? (toolCallId ? toolNames.get(toolCallId) : undefined) ?? "tool";
      const output = nestedActivityText(source.content ?? candidate.content, 12_000);
      const activity = activityForTool({ ...source, id: toolCallId, name, output, status: candidate.isError === true || source.isError === true ? "error" : "completed" }, sessionKey);
      if (activity) pending = mergeActivity(pending, activity);
      return;
    }

    const normalized = normalizeMessage(candidate, `${sessionKey}:${index}`);
    if (role === "assistant" && normalizedMessagePhase(candidate) === "commentary") {
      for (const message of normalized) {
        pending = mergeActivity(pending, {
          id: `thinking:${message.id}`,
          sessionKey,
          kind: "thinking",
          title: "Progress update",
          detail: safeActivityText(message.text, 2_400),
          state: "done",
        });
      }
      return;
    }
    for (const message of normalized) {
      const hasToolCall = blocks.some((block) => ["toolcall", "tooluse", "functioncall"].includes(historyBlockType(block)));
      if (message.role === "assistant" && !hasToolCall && pending.length) {
        message.activities = pending.map((activity) => ({ ...activity, state: activity.state === "running" ? "done" : activity.state }));
        pending = [];
      }
      messages.push(message);
    }
  });
  flushPending();
  return foldAssistantProgress(messages, sessionKey);
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
    messagePhase: normalizedMessagePhase(payload.message),
    messages: normalizeMessage(payload.message, fallbackId),
  };
}
