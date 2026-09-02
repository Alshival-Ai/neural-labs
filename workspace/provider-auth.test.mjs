import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createProviderAuthController, parseOpenAIDeviceCode } from "./provider-auth.mjs";

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 98765;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }
}

test("parses OpenClaw's device-code presentation without retaining terminal controls", () => {
  assert.deepEqual(
    parseOpenAIDeviceCode(
      "\u001b[2KURL: https://auth.openai.com/codex/device\r\nCode: ABCD-EFGHJ\r\nCode expires in 15 minutes.",
    ),
    {
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-EFGHJ",
      expiresInMinutes: 15,
    },
  );
});

test("runs one device-code login at a time and exposes only the short-lived pairing data", () => {
  const child = new FakeChild();
  let authenticated = false;
  let starts = 0;
  const controller = createProviderAuthController({
    providerAuthenticated: () => authenticated,
    modelReady: () => authenticated,
    spawnLogin: () => {
      starts += 1;
      return child;
    },
    now: () => Date.parse("2026-09-01T12:00:00.000Z"),
  });

  assert.equal(controller.start().state, "starting");
  assert.equal(controller.start().state, "starting");
  assert.equal(starts, 1);

  child.stdout.emit(
    "data",
    "URL: https://auth.openai.com/codex/device\nCode: ABCD-EFGHJ\nCode expires in 15 minutes.",
  );
  assert.deepEqual(controller.snapshot(), {
    provider: "openai",
    authMethod: "chatgpt",
    state: "awaiting_user",
    verificationUrl: "https://auth.openai.com/codex/device",
    userCode: "ABCD-EFGHJ",
    expiresAt: "2026-09-01T12:15:00.000Z",
    message: null,
    authenticated: false,
    modelReady: false,
  });

  authenticated = true;
  child.emit("exit", 0, null);
  assert.equal(controller.snapshot().state, "connected");
  assert.equal(controller.snapshot().authenticated, true);
});

test("does not misreport a local Gateway authorization failure as an OpenAI outage", () => {
  const child = new FakeChild();
  const controller = createProviderAuthController({
    providerAuthenticated: () => false,
    modelReady: () => false,
    spawnLogin: () => child,
  });

  controller.start();
  child.stderr.emit(
    "data",
    "unauthorized reason=trusted_proxy_untrusted_source phase=auth_credentials_received",
  );
  child.emit("exit", 1, null);

  assert.equal(controller.snapshot().state, "error");
  assert.equal(
    controller.snapshot().message,
    "OpenClaw rejected its local login client. Restart the workspace and try again.",
  );
});
