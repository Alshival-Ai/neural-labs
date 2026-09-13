import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createProviderAuthController, parseOpenAIDeviceCode, spawnBackgroundLogin } from "./provider-auth.mjs";

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 98765;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }
}

test("disconnect waits for the cancelled login process to close without refreshing auth", async () => {
  const child = new FakeChild();
  child.pid = undefined;
  let refreshed = false;
  const controller = createProviderAuthController({ providerAuthenticated: () => false, modelReady: () => false, spawnLogin: () => child, refreshStatus: async () => { refreshed = true; } });
  controller.start();
  let stopped = false;
  const pending = controller.cancelAndWait().then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false);
  child.emit("exit", 0, null);
  child.emit("close", 0, null);
  await pending;
  assert.equal(stopped, true);
  assert.equal(refreshed, false);
  assert.equal(controller.snapshot().state, "disconnected");
});

test("background login explicitly owns main without resetting models or passing the audio API key", () => {
  const child = new FakeChild();
  const result = spawnBackgroundLogin((command, args, options) => {
    assert.equal(command, "script");
    assert.equal(args[1], "openclaw models auth login --agent main --provider openai --device-code --profile-id openai:neural-labs-background");
    assert.equal(options.env.OPENAI_API_KEY, undefined);
    assert.equal(options.detached, true);
    return child;
  });
  assert.equal(result, child);
});

test("a late login refresh cannot overwrite a disconnect result", async () => {
  const child = new FakeChild();
  let finish;
  const controller = createProviderAuthController({ providerAuthenticated: () => false, modelReady: () => false, spawnLogin: () => child, refreshStatus: () => new Promise((resolve) => { finish = resolve; }) });
  controller.start();
  child.emit("exit", 0, null);
  controller.cancel();
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.snapshot().state, "disconnected");
  assert.equal(controller.snapshot().message, null);
});

test("missing model owner errors remain actionable without exposing raw login output", () => {
  const child = new FakeChild();
  const controller = createProviderAuthController({ providerAuthenticated: () => false, modelReady: () => false, spawnLogin: () => child });
  controller.start();
  child.stderr.emit("data", "Multiple agents are configured, but the model command has no explicit owner. Pass --agent <id>. private-context");
  child.emit("exit", 1, null);
  assert.match(controller.snapshot().message, /missing its agent owner/);
  assert.doesNotMatch(controller.snapshot().message, /private-context/);
});

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

test("refreshes provider status after a successful login before classifying the result", async () => {
  const child = new FakeChild();
  let authenticated = false;
  let refreshes = 0;
  const controller = createProviderAuthController({
    providerAuthenticated: () => authenticated,
    modelReady: () => authenticated,
    refreshStatus: async () => {
      refreshes += 1;
      authenticated = true;
    },
    spawnLogin: () => child,
  });

  controller.start();
  child.stderr.emit(
    "data",
    "unauthorized reason=trusted_proxy_untrusted_source phase=auth_credentials_received",
  );
  child.emit("exit", 0, null);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(refreshes, 1);
  assert.equal(controller.snapshot().state, "connected");
  assert.equal(controller.snapshot().authenticated, true);
});


test("background reconnect can replace a saved credential without reporting the old login as success", () => {
  const child = new FakeChild();
  const controller = createProviderAuthController({providerAuthenticated: () => true, modelReady: () => true, allowReconnect: true, spawnLogin: () => child});
  assert.equal(controller.start().state, "starting");
  child.stdout.emit("data", "URL: https://auth.openai.com/codex/device\nCode: TEST-CODE");
  assert.equal(controller.snapshot().state, "awaiting_user");
  controller.cancel();
});
