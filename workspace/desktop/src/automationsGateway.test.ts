import { describe, expect, it, vi } from "vitest";

import type { AutomationDraft } from "./AutomationsApp";
import { GATEWAY_CLIENT_IDS } from "@openclaw/gateway-protocol/client-info";

import {
  AUTOMATIONS_CLIENT_INFO,
  AUTOMATIONS_CONNECTION_SCOPES,
  draftToGatewayParams,
  mapAutomationsSnapshot,
  automationRequest,
} from "./automationsGateway";

const baseDraft: AutomationDraft = {
  name: "Morning brief",
  description: "Summarize overnight work",
  scheduleKind: "cron",
  scheduleValue: "0 7 * * 1-5",
  timezone: "America/Chicago",
  exact: true,
  triggerScript: "",
  pacingMin: "",
  pacingMax: "",
  payloadKind: "agentTurn",
  payload: "Summarize overnight work.",
  workingDirectory: "/home/node/workspace",
  sessionTarget: "isolated",
  wakeMode: "now",
  agent: "main",
  deliveryMode: "none",
  channel: "last",
  target: "",
  model: "Workspace default",
  thinking: "medium",
  tools: "read, exec",
  timeoutSeconds: "600",
  failureAlertAfter: "2",
};

describe("OpenClaw automation request mapping", () => {
  it("sends manual run identity to the authenticated HTTP adapter without an account override", async () => {
    const mocked = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accepted: true }) });
    vi.stubGlobal("fetch", mocked);
    try {
      await automationRequest("/workspace/api/automations/run", { jobId: "job", mode: "force", requestId: "request" });
      const [url, options] = mocked.mock.calls[0];
      expect(url).toBe("/workspace/api/automations/run");
      expect(options.credentials).toBe("same-origin");
      expect(JSON.parse(options.body)).toEqual({ jobId: "job", mode: "force", requestId: "request" });
      mocked.mockResolvedValue({ ok: false, json: async () => ({ error: { message: "Connect your ChatGPT account" } }) });
      await expect(automationRequest(url, {})).rejects.toThrow("Connect your ChatGPT account");
    } finally { vi.unstubAllGlobals(); }
  });
  it("explicitly clears old pins when editing back to agent defaults", () => {
    expect(draftToGatewayParams({ ...baseDraft, model: "", thinking: "" }, true).payload)
      .toMatchObject({ model: null, fallbacks: null, thinking: null });
    expect(draftToGatewayParams({ ...baseDraft, model: "openai/gpt-6-astra", thinking: "off" }, true).payload)
      .toMatchObject({ model: "openai/gpt-6-astra", fallbacks: [], thinking: "off" });
  });
  it("preserves explicit reasoning off and makes explicit model pins strict", () => {
    const params = draftToGatewayParams({ ...baseDraft, model: "openai/gpt-6-astra", thinking: "off" });
    expect(params.payload).toMatchObject({ model: "openai/gpt-6-astra", thinking: "off", fallbacks: [] });
    expect(draftToGatewayParams({ ...baseDraft, thinking: "" }).payload).not.toHaveProperty("thinking");
  });
  it("uses the generic Gateway identity instead of impersonating OpenClaw's build-coupled Control UI", () => {
    expect(AUTOMATIONS_CLIENT_INFO.id).toBe(GATEWAY_CLIENT_IDS.GATEWAY_CLIENT);
    expect(AUTOMATIONS_CLIENT_INFO.id).not.toBe(GATEWAY_CLIENT_IDS.CONTROL_UI);
  });

  it("requests the admin route's connection-only scope without a browser pairing", () => {
    expect(AUTOMATIONS_CONNECTION_SCOPES).toEqual(["operator.read", "operator.admin"]);
  });

  it("maps a calendar agent job to the current Gateway schema", () => {
    expect(draftToGatewayParams(baseDraft)).toEqual({
      name: "Morning brief",
      description: "Summarize overnight work",
      enabled: true,
      schedule: { kind: "cron", expr: "0 7 * * 1-5", tz: "America/Chicago", staggerMs: 0 },
      sessionTarget: "isolated",
      wakeMode: "now",
      agentId: "main",
      payload: {
        kind: "agentTurn",
        message: "Summarize overnight work.",
        thinking: "medium",
        timeoutSeconds: 600,
        toolsAllow: ["read", "exec"],
      },
      delivery: { mode: "none" },
      failureAlert: { after: 2 },
    });
  });

  it("maps stream argv and a match expression without treating it as a condition script", () => {
    const params = draftToGatewayParams({
      ...baseDraft,
      scheduleKind: "stream",
      scheduleValue: '["node","scripts/events.mjs"]',
      triggerScript: "^(failed|recovered):",
      payloadKind: "systemEvent",
      payload: "A build event changed.",
    });
    expect(params.schedule).toEqual({
      kind: "stream",
      command: ["node", "scripts/events.mjs"],
      cwd: "/home/node/workspace",
      mode: "match",
      match: "^(failed|recovered):",
    });
    expect(params).not.toHaveProperty("trigger");
  });

  it("rejects ambiguous stream commands before they reach OpenClaw", () => {
    expect(() => draftToGatewayParams({ ...baseDraft, scheduleKind: "stream", scheduleValue: "node scripts/events.mjs" }))
      .toThrow("Stream command argv must be a non-empty JSON array of strings.");
  });

  it("converts fixed intervals to milliseconds", () => {
    expect(draftToGatewayParams({ ...baseDraft, scheduleKind: "every", scheduleValue: "4h" }).schedule)
      .toEqual({ kind: "every", everyMs: 14_400_000 });
  });

  it("keeps operational state visible while removing administrator-only configuration", () => {
    const snapshot = mapAutomationsSnapshot(
      { enabled: true },
      { jobs: [{ id: "job-1", name: "Deploy watcher", enabled: true, schedule: { kind: "cron", expr: "0 * * * *" }, payload: { kind: "command", argv: ["deploy", "--token", "private"], cwd: "/private" }, delivery: { mode: "webhook", to: "https://internal.example" }, agentId: "main" }] },
      { entries: [{ jobId: "job-1", runId: "run-1", status: "error", error: "private command failed", runAtMs: Date.now() }] },
      true,
    );
    expect(snapshot.jobs[0]).toMatchObject({ name: "Deploy watcher", enabled: true, payload: { content: "Configuration hidden from non-administrators" }, agent: "Workspace agent" });
    expect(snapshot.jobs[0].payload.workingDirectory).toBeUndefined();
    expect(snapshot.jobs[0].delivery.target).toBeUndefined();
    expect(snapshot.jobs[0].runs[0].error).toBeUndefined();
  });

  it("hides upstream Skill Workshop maintenance jobs identified by declaration key", () => {
    const snapshot = mapAutomationsSnapshot({ enabled: true }, { jobs: [
      { id: "review", declarationKey: "skill-collection-review:main", displayName: "Skill collection review (main)", enabled: false, schedule: { kind: "every", everyMs: 604_800_000 }, payload: { kind: "agentTurn", message: "Review skills" } },
      { id: "brief", name: "Morning brief", enabled: true, schedule: { kind: "cron", expr: "0 7 * * *" }, payload: { kind: "agentTurn", message: "Summarize" } },
    ] }, { entries: [] });

    expect(snapshot.jobs.map((job) => job.id)).toEqual(["brief"]);
  });
});

describe('saved automation copies',()=>{
 it('preserves canonical settings while dropping runtime identity and pausing',async()=>{
  const {automationCopyParams}=await import('./automationsGateway');
  const original={id:'source',name:'Example',enabled:true,state:{runningAtMs:10},configRevision:'old',deleteAfterRun:true,schedule:{kind:'cron',expr:'0 9 * * *',tz:'America/Chicago',staggerMs:9000},payload:{kind:'agentTurn',message:'Run',lightContext:false,fallbacks:['model'],toolsAllow:[]},delivery:{mode:'none'},failureAlert:{after:3,cooldownMs:5000}};
  const copy=automationCopyParams(original,['Example copy']);expect(copy.name).toBe('Example copy 2');expect(copy.enabled).toBe(false);expect(copy.id).toBeUndefined();expect(copy.state).toBeUndefined();expect(copy.configRevision).toBeUndefined();expect(copy.payload).toEqual(original.payload);expect(copy.schedule).toEqual(original.schedule);expect(copy.failureAlert).toEqual(original.failureAlert);expect(copy.deleteAfterRun).toBe(true);
  expect(()=>automationCopyParams({payload:{kind:'heartbeat'}},[])).toThrow('System');
  expect(()=>automationCopyParams({declarationKey:'skill-collection-review:main',payload:{kind:'agentTurn'}},[])).toThrow('System');
 });
});
