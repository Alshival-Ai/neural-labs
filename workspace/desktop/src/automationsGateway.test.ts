import { describe, expect, it } from "vitest";

import type { AutomationDraft } from "./AutomationsApp";
import { GATEWAY_CLIENT_IDS } from "@openclaw/gateway-protocol/client-info";

import {
  AUTOMATIONS_CLIENT_INFO,
  AUTOMATIONS_CONNECTION_SCOPES,
  draftToGatewayParams,
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
});
