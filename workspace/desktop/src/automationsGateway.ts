import {
  GatewayProtocolClient,
  type GatewayProtocolSocketHandlers,
} from "@openclaw/gateway-client/browser";
import { GATEWAY_CLIENT_IDS, GATEWAY_CLIENT_MODES } from "@openclaw/gateway-protocol/client-info";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";

import type {
  AutomationAccent,
  AutomationDraft,
  AutomationJob,
  AutomationRun,
  AutomationRunMode,
  AutomationScheduleKind,
} from "./AutomationsApp";
import type { ConnectionState } from "./types";
import type { ClawHubResult, SkillProposal, SkillProposalAction, SkillProposalDraft, SkillRecord } from "./SkillsApp";

const CLIENT_VERSION = "0.3.0";
const INSTANCE_KEY = "neural-labs.automations.instance.v1";
// This client intentionally has no browser device identity or reusable token.
// Nginx authenticates an active Neural Labs administrator, overwrites the
// trusted-proxy identity, and caps this connection to these exact scopes.
export const AUTOMATIONS_CONNECTION_SCOPES = ["operator.read", "operator.admin"] as const;

type RecordValue = Record<string, unknown>;
type AutomationsConnectPlan = { scopes: string[] };

export type AutomationsSnapshot = {
  schedulerOnline: boolean;
  jobs: AutomationJob[];
};

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function instanceId(): string {
  const existing = localStorage.getItem(INSTANCE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(INSTANCE_KEY, created);
  return created;
}

function socketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/workspace/automations/socket`;
}

function createSocket(handlers: GatewayProtocolSocketHandlers) {
  const socket = new WebSocket(socketUrl());
  socket.addEventListener("open", handlers.open);
  socket.addEventListener("message", (event) => handlers.message(String(event.data)));
  socket.addEventListener("close", (event) => handlers.close(event.code, event.reason));
  socket.addEventListener("error", () => handlers.error(new Error("Automations Gateway connection failed")));
  return {
    isOpen: () => socket.readyState === WebSocket.OPEN,
    send: (data: string) => socket.send(data),
    close: (code?: number, reason?: string) => socket.close(code, reason),
  };
}

// Automations is a Neural Labs protocol client, not OpenClaw's bundled Control
// UI. Using the Control UI identity makes OpenClaw require its private build ID
// and reject independently deployed clients after every Gateway build.
export const AUTOMATIONS_CLIENT_INFO = {
  id: GATEWAY_CLIENT_IDS.GATEWAY_CLIENT,
  displayName: "Neural Labs Automations",
  version: CLIENT_VERSION,
  platform: "web",
  deviceFamily: "browser",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  mode: GATEWAY_CLIENT_MODES.UI,
  instanceId: instanceId(),
} as const;

export class AutomationsGateway {
  private readonly statusListeners = new Set<(state: ConnectionState, error?: string) => void>();
  private readonly changeListeners = new Set<() => void>();
  private readonly client: GatewayProtocolClient<AutomationsConnectPlan>;
  private started = false;
  private currentStatus: ConnectionState = "disconnected";
  private currentError?: string;
  private reauthorizeTimer?: number;

  constructor() {
    this.client = new GatewayProtocolClient({
      createSocket,
      createRequestId: () => crypto.randomUUID(),
      buildConnectPlan: () => ({ scopes: [...AUTOMATIONS_CONNECTION_SCOPES] }),
      buildConnectParams: (plan) => ({
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: AUTOMATIONS_CLIENT_INFO,
        caps: [],
        role: "operator",
        scopes: plan.scopes,
        locale: navigator.language,
        userAgent: navigator.userAgent,
      }),
      onHello: () => {
        this.setStatus("connected");
        window.clearTimeout(this.reauthorizeTimer);
        this.reauthorizeTimer = window.setTimeout(() => this.client.closeSocket(4000, "Refreshing administrator authorization"), 5 * 60_000);
      },
      onConnectFailure: (error) => ({ closeCode: 4003, closeReason: "Gateway rejected the Automations connection", error, reconnectDelayMs: 4_000 }),
      resolveClose: ({ code, connectFailure }) => ({ retry: code !== 1000, notify: true, reconnectDelayMs: connectFailure?.reconnectDelayMs, pendingError: connectFailure?.error }),
      onClose: (context) => {
        window.clearTimeout(this.reauthorizeTimer);
        if (context.code !== 1000) this.setStatus("disconnected", context.connectFailure?.error.message);
      },
      onConnectError: (error) => this.setStatus("error", error.message),
      onSocketFactoryError: (error) => this.setStatus("error", error.message),
      onEvent: (event) => {
        if (event.event === "cron" || event.event.startsWith("cron.")) {
          for (const listener of this.changeListeners) listener();
        }
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
    window.clearTimeout(this.reauthorizeTimer);
    this.client.stop();
    this.setStatus("disconnected");
  }

  onStatus(listener: (state: ConnectionState, error?: string) => void) {
    this.statusListeners.add(listener);
    listener(this.currentStatus, this.currentError);
    return () => this.statusListeners.delete(listener);
  }

  onChanged(listener: () => void) {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private setStatus(state: ConnectionState, error?: string) {
    this.currentStatus = state;
    this.currentError = error;
    for (const listener of this.statusListeners) listener(state, error);
  }

  async snapshot(): Promise<AutomationsSnapshot> {
    const [status, listed, history] = await Promise.all([
      this.client.request<unknown>("cron.status", {}),
      this.client.request<unknown>("cron.list", { includeDisabled: true, limit: 200, sortBy: "updatedAtMs", sortDir: "desc", includeDeliveryPreviews: true }),
      this.client.request<unknown>("cron.runs", { scope: "all", limit: 200, sortDir: "desc" }),
    ]);
    const jobs = isRecord(listed) && Array.isArray(listed.jobs) ? listed.jobs : Array.isArray(listed) ? listed : [];
    const entries = isRecord(history) && Array.isArray(history.entries) ? history.entries : Array.isArray(history) ? history : [];
    const runsByJob = new Map<string, AutomationRun[]>();
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const jobId = stringValue(entry.jobId);
      if (!jobId) continue;
      runsByJob.set(jobId, [...(runsByJob.get(jobId) ?? []), mapRun(entry)]);
    }
    return {
      schedulerOnline: !isRecord(status) || status.enabled !== false,
      jobs: jobs.flatMap((job, index) => isRecord(job) ? [mapJob(job, runsByJob.get(stringValue(job.id) ?? "") ?? [], index)] : []),
    };
  }

  create(draft: AutomationDraft) {
    return this.client.request("cron.add", draftToGatewayParams(draft));
  }

  update(job: AutomationJob, draft: AutomationDraft) {
    const patch = draftToGatewayParams(draft);
    patch.enabled = job.enabled;
    const params: RecordValue = { id: job.id, patch };
    if (job.configRevision) params.expectedConfigRevision = job.configRevision;
    return this.client.request("cron.update", params);
  }

  toggle(job: AutomationJob, enabled: boolean) {
    const params: RecordValue = { id: job.id, patch: { enabled } };
    if (job.configRevision) params.expectedConfigRevision = job.configRevision;
    return this.client.request("cron.update", params);
  }

  run(job: AutomationJob, mode: AutomationRunMode) {
    return this.client.request("cron.run", { id: job.id, mode });
  }

  remove(job: AutomationJob) {
    return this.client.request("cron.remove", { id: job.id });
  }

  updateSkill(skill: SkillRecord, enabled: boolean) {
    return this.client.request("skills.update", { skillKey: skill.key, enabled });
  }

  installSkill(result: ClawHubResult) {
    return this.client.request("skills.install", {
      agentId: "main",
      source: "clawhub",
      slug: result.installRef,
      ...(result.version && result.version !== "latest" ? { version: result.version } : {}),
    });
  }

  createSkillProposal(draft: SkillProposalDraft) {
    const params = {
      agentId: "main",
      name: draft.name.trim(),
      description: draft.description.trim(),
      content: draft.instructions.trim(),
      goal: draft.goal.trim(),
      evidence: "Submitted by a Neural Labs administrator through Skill Workshop.",
    };
    return draft.kind === "update" && draft.target
      ? this.client.request("skills.proposals.update", { ...params, skillName: draft.target })
      : this.client.request("skills.proposals.create", params);
  }

  async actOnSkillProposal(proposal: SkillProposal, action: Exclude<SkillProposalAction, "request-revision">) {
    const inspected = await this.client.request<unknown>("skills.proposals.inspect", { agentId: "main", proposalId: proposal.id });
    const revisionHash = isRecord(inspected) ? stringValue(inspected.revisionHash) : undefined;
    if (!revisionHash) throw new Error("OpenClaw did not return the proposal revision required for this action.");
    const method = action === "evaluate" ? "skills.proposals.evaluate"
      : action === "apply" ? "skills.proposals.apply"
      : action === "reject" ? "skills.proposals.reject"
      : "skills.proposals.quarantine";
    return this.client.request(method, {
      agentId: "main",
      proposalId: proposal.id,
      expectedRevisionHash: revisionHash,
      correlationId: crypto.randomUUID(),
    });
  }

  scanSkillHistory() {
    return this.client.request("skills.proposals.historyScan", { agentId: "main", direction: "older" });
  }
}

export function mapAutomationsSnapshot(status: unknown, listed: unknown, history: unknown, operationalOnly = false): AutomationsSnapshot {
  const jobs = isRecord(listed) && Array.isArray(listed.jobs) ? listed.jobs : Array.isArray(listed) ? listed : [];
  const entries = isRecord(history) && Array.isArray(history.entries) ? history.entries : Array.isArray(history) ? history : [];
  const runsByJob = new Map<string, AutomationRun[]>();
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const jobId = stringValue(entry.jobId);
    if (!jobId) continue;
    runsByJob.set(jobId, [...(runsByJob.get(jobId) ?? []), mapRun(entry)]);
  }
  const mapped: AutomationsSnapshot = {
    schedulerOnline: !isRecord(status) || status.enabled !== false,
    jobs: jobs.flatMap((job, index) => isRecord(job) ? [mapJob(job, runsByJob.get(stringValue(job.id) ?? "") ?? [], index)] : []),
  };
  if (!operationalOnly) return mapped;
  return { ...mapped, jobs: mapped.jobs.map((job) => ({
    ...job,
    schedule: { ...job.schedule, trigger: undefined, workingDirectory: undefined },
    payload: { ...job.payload, content: "Configuration hidden from non-administrators", model: undefined, thinking: undefined, tools: undefined, workingDirectory: undefined },
    agent: "Workspace agent",
    delivery: { ...job.delivery, target: undefined, channel: undefined },
    runs: job.runs.map((run) => ({ ...run, model: undefined, usage: undefined, error: undefined })),
  })) };
}

function mapJob(job: RecordValue, runs: AutomationRun[], index: number): AutomationJob {
  const id = stringValue(job.id) ?? `unknown-${index}`;
  const schedule = isRecord(job.schedule) ? job.schedule : {};
  const payload = isRecord(job.payload) ? job.payload : {};
  const delivery = isRecord(job.delivery) ? job.delivery : {};
  const state = isRecord(job.state) ? job.state : {};
  const scheduleKind = scheduleKindValue(schedule.kind);
  const payloadKind = payloadKindValue(payload.kind);
  const runningAt = numberValue(state.runningAtMs);
  const nextRunAt = numberValue(state.nextRunAtMs) ?? numberValue(job.nextRunAtMs);
  const lastRunAt = numberValue(state.lastRunAtMs) ?? numberValue(job.lastRunAtMs);
  const lastStatus = statusValue(state.lastRunStatus) ?? statusValue(state.lastStatus) ?? statusValue(job.lastRunStatus) ?? "skipped";
  const autoDisabled = isRecord(state.autoDisabled) ? state.autoDisabled : undefined;
  const deliveryMode = delivery.mode === "announce" || delivery.mode === "webhook" ? delivery.mode : "none";
  const channel = stringValue(delivery.channel);
  const target = stringValue(delivery.to);
  const content = payloadKind === "systemEvent" ? stringValue(payload.text)
    : payloadKind === "agentTurn" ? stringValue(payload.message)
    : payloadKind === "command" ? JSON.stringify(Array.isArray(payload.argv) ? payload.argv : [])
    : payloadKind === "script" ? stringValue(payload.script)
    : payloadKind === "heartbeat" ? "OpenClaw heartbeat task" : "OpenClaw skill collection review";
  const streamStatus = stringValue(state.streamStatus);
  const normalizedRuns = runningAt && !runs.some((run) => run.status === "running")
    ? [{ id: `${id}:running:${runningAt}`, status: "running" as const, started: formatDate(runningAt), duration: formatDuration(Date.now() - runningAt), summary: "OpenClaw is running this automation.", deliveryStatus: "pending" as const }, ...runs]
    : runs;
  return {
    id,
    configRevision: stringValue(job.configRevision),
    name: stringValue(job.displayName) ?? stringValue(job.name) ?? "Untitled automation",
    description: stringValue(job.description) ?? "Shared OpenClaw automation",
    accent: accentFor(id),
    enabled: booleanValue(job.enabled) ?? false,
    running: Boolean(runningAt) || streamStatus === "running" || streamStatus === "starting",
    systemOwned: payloadKind === "heartbeat" || payloadKind === "skillCollectionReview",
    deleteAfterRun: booleanValue(job.deleteAfterRun),
    autoDisabled: autoDisabled ? {
      reason: autoDisabled.reason === "schedule-errors" ? "schedule-errors" : "consecutive-failures",
      consecutiveErrors: numberValue(autoDisabled.consecutiveErrors) ?? 0,
    } : undefined,
    schedule: mapSchedule(scheduleKind, schedule, isRecord(job.trigger) ? job.trigger : undefined, isRecord(job.pacing) ? job.pacing : undefined),
    payload: {
      kind: payloadKind,
      label: payloadKind === "systemEvent" ? "System event" : payloadKind === "agentTurn" ? "Agent message" : payloadKind === "command" ? "Command" : payloadKind === "script" ? "Script" : payloadKind === "heartbeat" ? "Heartbeat" : "Skill collection review",
      content: content ?? "No payload details available",
      model: stringValue(payload.model),
      thinking: stringValue(payload.thinking),
      tools: Array.isArray(payload.toolsAllow) ? payload.toolsAllow.filter((tool): tool is string => typeof tool === "string") : undefined,
      timeout: numberValue(payload.timeoutSeconds) === undefined ? undefined : `${numberValue(payload.timeoutSeconds)} sec`,
      workingDirectory: stringValue(payload.cwd),
    },
    sessionTarget: sessionTargetValue(job.sessionTarget),
    wakeMode: job.wakeMode === "next-heartbeat" ? "next-heartbeat" : "now",
    agent: stringValue(job.agentId) ?? (isRecord(job.owner) ? stringValue(job.owner.agentId) : undefined) ?? "main",
    delivery: {
      mode: deliveryMode,
      label: deliveryMode === "announce" ? "Announce" : deliveryMode === "webhook" ? "Webhook" : "No delivery",
      target: [channel, target].filter(Boolean).join(" · ") || undefined,
      channel,
      bestEffort: booleanValue(delivery.bestEffort),
    },
    nextRun: runningAt ? "Running now" : nextRunAt ? formatDate(nextRunAt) : scheduleKind === "stream" && streamStatus ? streamStatus : job.enabled ? "Awaiting schedule" : "Paused",
    nextRunDetail: nextRunAt ? relativeDate(nextRunAt) : stringValue(state.streamError) ?? "",
    lastRun: lastRunAt ? formatDate(lastRunAt) : "Never",
    lastStatus,
    consecutiveErrors: numberValue(state.consecutiveErrors) ?? 0,
    runs: normalizedRuns,
  };
}

function mapSchedule(kind: AutomationScheduleKind, schedule: RecordValue, trigger?: RecordValue, pacing?: RecordValue): AutomationJob["schedule"] {
  if (kind === "at") {
    const at = stringValue(schedule.at) ?? "";
    const time = Date.parse(at);
    return { kind, label: Number.isFinite(time) ? formatDate(time) : at, detail: "One-time schedule", expression: at, exact: true };
  }
  if (kind === "every") {
    const everyMs = numberValue(schedule.everyMs) ?? 0;
    return { kind, label: `Every ${formatDuration(everyMs)}`, detail: "Fixed interval", expression: durationExpression(everyMs), trigger: stringValue(trigger?.script), pacing: pacingLabel(pacing) };
  }
  if (kind === "cron") {
    const expression = stringValue(schedule.expr) ?? "";
    return { kind, label: `Cron · ${expression}`, detail: "Calendar schedule", expression, timezone: stringValue(schedule.tz), exact: schedule.staggerMs === 0, trigger: stringValue(trigger?.script), pacing: pacingLabel(pacing) };
  }
  if (kind === "on-exit") {
    const command = stringValue(schedule.command) ?? "";
    return { kind, label: "When process exits", detail: stringValue(schedule.cwd) ?? "Process watcher", expression: command, workingDirectory: stringValue(schedule.cwd) };
  }
  const command = Array.isArray(schedule.command) ? JSON.stringify(schedule.command) : "[]";
  return { kind, label: "Live event stream", detail: stringValue(schedule.mode) === "match" ? `match · ${stringValue(schedule.match) ?? ""}` : "all lines", expression: command, trigger: stringValue(schedule.match), workingDirectory: stringValue(schedule.cwd) };
}

function mapRun(run: RecordValue): AutomationRun {
  const started = numberValue(run.runAtMs) ?? numberValue(run.ts) ?? Date.now();
  const status = statusValue(run.status) ?? "skipped";
  const usage = isRecord(run.usage) ? numberValue(run.usage.total_tokens) : undefined;
  const rawDelivery = stringValue(run.deliveryStatus);
  return {
    id: stringValue(run.runId) ?? `${stringValue(run.jobId) ?? "job"}:${started}`,
    status,
    started: formatDate(started),
    duration: numberValue(run.durationMs) === undefined ? "—" : formatDuration(numberValue(run.durationMs)!),
    summary: stringValue(run.summary) ?? (status === "ok" ? "Automation completed." : status === "error" ? "Automation failed." : "Automation was skipped."),
    deliveryStatus: rawDelivery === "delivered" || rawDelivery === "not-delivered" || rawDelivery === "not-requested" || rawDelivery === "unknown" ? rawDelivery : "not-requested",
    model: [stringValue(run.provider), stringValue(run.model)].filter(Boolean).join("/") || undefined,
    usage: usage === undefined ? undefined : `${new Intl.NumberFormat().format(usage)} tokens`,
    error: stringValue(run.error) ?? stringValue(run.deliveryError),
  };
}

export function draftToGatewayParams(draft: AutomationDraft): RecordValue {
  const toolsAllow = draft.tools.split(",").map((tool) => tool.trim()).filter(Boolean);
  const timeoutSeconds = optionalPositiveNumber(draft.timeoutSeconds, "Timeout");
  const schedule = scheduleFromDraft(draft);
  const payload = draft.payloadKind === "systemEvent" ? { kind: "systemEvent", text: draft.payload.trim(), ...(toolsAllow.length ? { toolsAllow } : {}) }
    : draft.payloadKind === "agentTurn" ? { kind: "agentTurn", message: draft.payload.trim(), ...(draft.model && draft.model !== "Workspace default" ? { model: draft.model } : {}), ...(draft.thinking && draft.thinking !== "off" ? { thinking: draft.thinking } : {}), ...(timeoutSeconds ? { timeoutSeconds } : {}), ...(toolsAllow.length ? { toolsAllow } : {}) }
    : draft.payloadKind === "command" ? { kind: "command", argv: commandArgv(draft.payload), ...(draft.workingDirectory.trim() ? { cwd: draft.workingDirectory.trim() } : {}), ...(timeoutSeconds ? { timeoutSeconds } : {}), ...(toolsAllow.length ? { toolsAllow } : {}) }
    : { kind: "script", script: draft.payload.trim(), ...(timeoutSeconds ? { timeoutSeconds } : {}), ...(toolsAllow.length ? { toolsAllow } : {}) };
  const target = draft.target.trim();
  const delivery = draft.deliveryMode === "none" ? { mode: "none" }
    : draft.deliveryMode === "webhook" ? { mode: "webhook", to: target }
    : { mode: "announce", channel: draft.channel.trim() || "last", ...(target && target !== "Current conversation" ? { to: target } : {}) };
  const failureAfter = optionalPositiveInteger(draft.failureAlertAfter, "Failure alert threshold");
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    enabled: true,
    schedule,
    ...(draft.pacingMin.trim() || draft.pacingMax.trim() ? { pacing: { ...(draft.pacingMin.trim() ? { min: draft.pacingMin.trim() } : {}), ...(draft.pacingMax.trim() ? { max: draft.pacingMax.trim() } : {}) } } : {}),
    ...(draft.triggerScript.trim() && (draft.scheduleKind === "cron" || draft.scheduleKind === "every") ? { trigger: { script: draft.triggerScript.trim() } } : {}),
    sessionTarget: draft.sessionTarget,
    wakeMode: draft.wakeMode,
    agentId: draft.agent.trim() || "main",
    payload,
    delivery,
    ...(failureAfter ? { failureAlert: { after: failureAfter } } : {}),
  };
}

function scheduleFromDraft(draft: AutomationDraft): RecordValue {
  const value = draft.scheduleValue.trim();
  if (draft.scheduleKind === "at") return { kind: "at", at: zonedDateTimeToIso(value, draft.timezone) };
  if (draft.scheduleKind === "every") return { kind: "every", everyMs: parseDuration(value) };
  if (draft.scheduleKind === "cron") return { kind: "cron", expr: value, ...(draft.timezone.trim() ? { tz: draft.timezone.trim() } : {}), ...(draft.exact ? { staggerMs: 0 } : {}) };
  if (draft.scheduleKind === "on-exit") return { kind: "on-exit", command: value, ...(draft.workingDirectory.trim() ? { cwd: draft.workingDirectory.trim() } : {}) };
  const command = jsonStringArray(value, "Stream command argv");
  return { kind: "stream", command, ...(draft.workingDirectory.trim() ? { cwd: draft.workingDirectory.trim() } : {}), ...(draft.triggerScript.trim() ? { mode: "match", match: draft.triggerScript.trim() } : { mode: "line" }) };
}

function commandArgv(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) return jsonStringArray(trimmed, "Command argv");
  return ["/bin/sh", "-lc", trimmed];
}

function jsonStringArray(value: string, label: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((part) => typeof part !== "string" || !part.trim())) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} must be a non-empty JSON array of strings.`);
  }
}

function parseDuration(value: string): number {
  const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/);
  if (!match) throw new Error("Interval must use a duration such as 30m, 4h, or 1d.");
  const multipliers: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  const result = Number(match[1]) * multipliers[match[2]];
  if (!Number.isSafeInteger(result) || result < 1) throw new Error("Interval is outside the supported range.");
  return result;
}

function optionalPositiveNumber(value: string, label: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be a positive number.`);
  return number;
}

function optionalPositiveInteger(value: string, label: string): number | undefined {
  const number = optionalPositiveNumber(value, label);
  if (number === undefined) return undefined;
  if (!Number.isInteger(number)) throw new Error(`${label} must be a whole number.`);
  return number;
}

function zonedDateTimeToIso(value: string, timeZone: string): string {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const direct = new Date(value);
    if (!Number.isFinite(direct.getTime())) throw new Error("One-time schedule must be a valid date and time.");
    return direct.toISOString();
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error("One-time schedule must use an ISO date and time.");
  const parts = match.slice(1).map(Number);
  const wallClock = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5] ?? 0);
  try {
    let instant = wallClock;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const formatted = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(instant);
      const byType = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
      const represented = Date.UTC(Number(byType.year), Number(byType.month) - 1, Number(byType.day), Number(byType.hour), Number(byType.minute), Number(byType.second));
      instant = wallClock - (represented - instant);
    }
    return new Date(instant).toISOString();
  } catch {
    throw new Error("Choose a valid IANA timezone for the one-time schedule.");
  }
}

function scheduleKindValue(value: unknown): AutomationScheduleKind {
  return value === "at" || value === "every" || value === "on-exit" || value === "stream" ? value : "cron";
}

function payloadKindValue(value: unknown): AutomationJob["payload"]["kind"] {
  return value === "systemEvent" || value === "command" || value === "script" || value === "heartbeat" || value === "skillCollectionReview" ? value : "agentTurn";
}

function statusValue(value: unknown): "ok" | "error" | "skipped" | undefined {
  return value === "ok" || value === "error" || value === "skipped" ? value : undefined;
}

function sessionTargetValue(value: unknown): AutomationJob["sessionTarget"] {
  const target = stringValue(value);
  return target === "main" || target === "isolated" || target === "current" || target?.startsWith("session:") ? target as AutomationJob["sessionTarget"] : "isolated";
}

function accentFor(value: string): AutomationAccent {
  const accents: AutomationAccent[] = ["cyan", "violet", "pink", "coral", "amber", "mint"];
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return accents[Math.abs(hash) % accents.length];
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(value);
}

function relativeDate(value: number): string {
  const difference = value - Date.now();
  if (difference <= 0) return "due now";
  return `in ${formatDuration(difference)}`;
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${Math.max(0, Math.round(value))}ms`;
  if (value < 60_000) return `${Math.round(value / 1_000)}s`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)}m`;
  if (value < 86_400_000) return `${Math.round(value / 3_600_000)}h`;
  return `${Math.round(value / 86_400_000)}d`;
}

function durationExpression(value: number): string {
  if (value % 86_400_000 === 0) return `${value / 86_400_000}d`;
  if (value % 3_600_000 === 0) return `${value / 3_600_000}h`;
  if (value % 60_000 === 0) return `${value / 60_000}m`;
  if (value % 1_000 === 0) return `${value / 1_000}s`;
  return `${value}ms`;
}

function pacingLabel(value?: RecordValue): string | undefined {
  if (!value) return undefined;
  const min = stringValue(value.min);
  const max = stringValue(value.max);
  return min || max ? `${min ?? "open"}–${max ?? "open"}` : undefined;
}
