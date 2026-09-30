import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NativeRuntime } from "./native/runtime.mjs";
import { NativeState } from "./native/state.mjs";
import { NativeAccounts } from "./native/accounts.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-service-"));
  await mkdir(path.join(root, "workspace"));
  const leases = new Map(), launches = [], contexts = []; let calls = 0;
  const state = new NativeState(":memory:");
  const service = new NativeRuntime({ stateRoot: path.join(root, "state"), workspaceRoot: path.join(root, "workspace"), state,
    authorize: async id => { if (!leases.has(id)) throw new Error("revoked"); return leases.get(id); },
    launcher: async options => { launches.push(options); return { spawn() {}, exec() {} }; }, accounts: { status: async () => ({ ready: true }) },
    providers: { codex: async ctx => { calls++; contexts.push(ctx); await ctx.onSession(`native-session-${calls}`); await ctx.onEvent("output", { text: "fixture reply" }); return { status: "succeeded" }; } } });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const request = (operation, params = {}, actor = "member") => {
    const lease = `lease-${leases.size}`;
    leases.set(lease, { actor, actorRole: actor === "admin" ? "admin" : "user", connection: "account", binding: { provider: "codex", owner: "account", generation: 1, method: "subscription" },
      model: "fixture", background: false, purpose: operation, policy: { sandbox: "workspace-write", approval: "on-request" } });
    return service.handle({ actor, lease, operation, params });
  };
  return { service, request, leases, launches, contexts, calls: () => calls };
}
function automation() {
  return { id: "scheduled-job", name: "Fixture", enabled: true, actor: "scheduler-owner", model: "saved-model",
    connection: { owner: "saved-account", provider: "codex", method: "subscription", generation: 3 },
    executionPolicy: { sandbox: "read-only", approval: "on-request" },
    payload: { kind: "agentTurn", message: "fixture", timeoutSeconds: 120 },
    schedule: { kind: "every", everyMs: 60000, anchorMs: 0 } };
}
test("manual automation uses its initiating account without modifying the saved schedule and enforces its policy", async t => {
  const f = await fixture(t), job = automation();
  f.service.state.putJob(job); f.service.turns.gated = false; f.service.state.setMetadata("scheduling", "enabled");
  const claim = await f.request("jobs.run", { job: job.id, requestId: "manual-fixture" });
  await f.service.scheduler.drain();
  const receipt = f.service.state.db.prepare("SELECT * FROM occurrences WHERE id=?").get(claim.id);
  assert.equal(receipt.status, "succeeded"); assert.equal(receipt.actor, "member");
  assert.equal(JSON.parse(receipt.connection).owner, "account");
  assert.deepEqual(f.service.state.job(job.id).definition, job);
  assert.ok(f.launches.every(row => row.readOnly));
  assert.equal(f.contexts[0].background, false); assert.equal(f.contexts[0].model, "fixture");
  assert.equal(f.contexts[0].timeoutMs, 120000);
  assert.equal((await f.request("jobs.run", { job: job.id, requestId: "manual-fixture" })).accepted, false);
  assert.equal(f.calls(), 1);
});
test("manual run modes preserve pauses and claim a due occurrence exactly once across retries", async t => {
  const f = await fixture(t), job = { ...automation(), enabled: false };
  let now = 120000; f.service.state.now = () => now; f.service.scheduler.now = () => now;
  f.service.state.putJob(job); f.service.turns.gated = false; f.service.state.setMetadata("scheduling", "enabled");
  for (const mode of ["due", "if-enabled"]) await assert.rejects(f.request("jobs.run", { job: job.id, mode, requestId: `paused-${mode}` }), /paused/);
  await assert.rejects(f.request("jobs.run", { job: job.id, mode: "invalid", requestId: "bad-mode" }), /mode/);
  assert.equal(f.calls(), 0);
  await f.request("jobs.run", { job: job.id, mode: "force", requestId: "explicit-force" });
  await f.service.scheduler.drain(); assert.equal(f.calls(), 1);
  assert.equal(f.service.state.job(job.id).enabled, false);
  f.service.state.db.prepare("UPDATE jobs SET enabled=1 WHERE id=?").run(job.id);
  const due = await f.request("jobs.run", { job: job.id, mode: "due", requestId: "explicit-due" });
  await f.service.scheduler.drain(); assert.equal(f.calls(), 2);
  const receipt = f.service.state.db.prepare("SELECT * FROM occurrences WHERE id=?").get(due.id);
  assert.equal(receipt.occurrence, "every:120000"); assert.equal(receipt.actor, "member");
  assert.equal(JSON.parse(receipt.connection).owner, "account");
  assert.equal(f.service.state.job(job.id).definition.connection.owner, "saved-account");
  assert.equal(f.service.state.claim({ jobId: job.id, occurrence: receipt.occurrence, actor: job.actor, connection: job.connection }).accepted, false);
  now += 60000;
  const retried = await f.request("jobs.run", { job: job.id, mode: "due", requestId: "explicit-due" });
  assert.equal(retried.accepted, false); assert.equal(retried.previous.id, due.id); assert.equal(f.calls(), 2);
  await assert.rejects(f.request("jobs.run", { job: job.id, mode: "force", requestId: "explicit-due" }), /binding/);
});
test("run only if due cannot fabricate an event and completes a pending one-time schedule", async t => {
  const f = await fixture(t), job = automation();
  f.service.state.now = () => 120000; f.service.scheduler.now = () => 120000;
  f.service.turns.gated = false; f.service.state.setMetadata("scheduling", "enabled");
  for (const [id, schedule] of [["future", { kind: "at", at: "2030-01-01T00:00:00Z" }],
    ["event", { kind: "process", source: "terminal-1" }], ["once", { kind: "at", at: "1970-01-01T00:01:00Z" }]]) {
    f.service.state.putJob({ ...job, id, schedule });
  }
  for (const id of ["future", "event"]) await assert.rejects(f.request("jobs.run", { job: id, mode: "due", requestId: id }), /not due/);
  const result = await f.request("jobs.run", { job: "once", mode: "due", requestId: "once" });
  await f.service.scheduler.drain(); assert.equal(f.calls(), 1);
  assert.equal(f.service.state.job("once").completed, true);
  assert.equal((await f.request("jobs.run", { job: "once", mode: "due", requestId: "once" })).previous.id, result.id);
  await assert.rejects(f.request("jobs.run", { job: "once", mode: "due", requestId: "once-again" }), /not due/);
});
test("scheduled automation requires separate background authority and persists unavailable-account holds", async t => {
  const f = await fixture(t), job = automation(), seen = [];
  f.service.state.putJob(job); f.service.turns.gated = false; f.service.state.setMetadata("scheduling", "enabled");
  f.service.authorize = async selection => {
    seen.push(selection);
    return { actor: job.actor, connection: job.connection.owner, binding: job.connection, model: job.model,
      policy: job.executionPolicy, background: true, authorityGeneration: 4 };
  };
  const claim = await f.service.scheduler.launch(job.id, "every:60000");
  await f.service.scheduler.drain();
  assert.equal(f.service.state.db.prepare("SELECT status FROM occurrences WHERE id=?").get(claim.id).status, "succeeded");
  assert.equal(f.contexts[0].background, true); assert.equal(f.contexts[0].model, job.model);
  assert.ok(seen.every(row => row.job === job.id && row.actor === job.actor && row.connection === job.connection.owner));
  f.service.accounts.status = async () => ({ ready: false });
  const blocked = await f.service.scheduler.launch(job.id, "every:120000");
  assert.equal(blocked.blocked, true); assert.equal(f.calls(), 1);
  assert.equal(f.service.state.job(job.id).enabled, true); assert.ok(f.service.state.job(job.id).hold);
  assert.equal(f.service.state.db.prepare("SELECT status FROM occurrences WHERE id=?").get(blocked.id).status, "blocked");
});
test("authenticated native service executes, reconnects and keeps actor ownership", async t => {
  const f = await fixture(t);
  await assert.rejects(f.request("conversations.create"), /admission/);
  f.service.turns.gated = false;
  const { session } = await f.request("conversations.create");
  const input = [{ type: "text", text: "fixture" }];
  const turn = await f.request("turns.start", { conversation: session.key, requestId: "request-1", input });
  await f.service.turns.active.get(turn.id)?.done;
  const result = await f.request("events.read", { conversation: session.key });
  assert.deepEqual(result.events.map(row => row.type), ["turn-started", "output", "turn-completed"]);
  assert.equal((await f.request("events.read", { conversation: session.key, after: result.cursor })).events.length, 0);
  assert.equal((await f.request("turns.start", { conversation: session.key, requestId: "request-1", input })).accepted, false);
  assert.equal(f.calls(), 1);
  await assert.rejects(f.request("events.read", { conversation: session.key }, "other-member"), /binding/);
  await f.request("conversations.update", { conversation: session.key, patch: { title: "Retained title", archived: true } });
  const list = await f.request("conversations.list");
  assert.equal(list.sessions[0].title, "Retained title"); assert.equal(list.sessions[0].archived, true);
  await f.request("conversations.delete", { conversation: session.key });
  assert.equal((await f.request("conversations.list")).sessions.length, 0);
  assert.equal(f.service.state.db.prepare("SELECT COUNT(*) AS n FROM turns").get().n, 1);
});
test("Team Chat runs through the native CLI with a revalidated Team-only binding", async t => {
  const f = await fixture(t); f.service.turns.gated = false;
  const input = { run: "team-run", channel: "team-channel", actor: "member",
    capability: "team-capability-at-least-thirty-two-characters", prompt: "Help the team", trigger: "@Alshival help" };
  f.service.authorize = async lease => {
    assert.equal(lease.team, true);
    assert.equal(lease.run, input.run);
    return { actor: input.actor, actorRole: "user", connection: "team-account",
      binding: { provider: "codex", owner: "team-account", generation: 1, method: "subscription" },
      model: "fixture", background: false, scope: "team", purpose: "team-run",
      team: { run: input.run, channel: input.channel, capability: input.capability, revision: 1 },
      policy: { sandbox: "workspace-write", approval: "on-request" } };
  };
  assert.deepEqual(await f.service.runTeam(input), { reply: "fixture reply" });
  assert.equal(f.contexts[0].model, "fixture");
  assert.equal(f.contexts[0].background, false);
  assert.equal(f.launches[0].homeRoot.endsWith("/accounts/team-account"), true);
});
test("Team Chat permissions wait for an explicit administrator decision", async t => {
  const f = await fixture(t); f.service.turns.gated = false;
  const input = { run: "team-approval-run", channel: "team-channel", actor: "member",
    capability: "team-capability-at-least-thirty-two-characters", prompt: "Run a command", trigger: "@Alshival run a command" };
  f.service.authorize = async () => ({ actor: input.actor, actorRole: "user", connection: "team-account",
    binding: { provider: "codex", owner: "team-account", generation: 1, method: "subscription" },
    model: "fixture", background: false, scope: "team", purpose: "team-run",
    team: { run: input.run, channel: input.channel, capability: input.capability, revision: 1 },
    policy: { sandbox: "workspace-write", approval: "on-request" } });
  let received;
  f.service.turns.providers.codex = async ctx => {
    received = await ctx.approve({ method: "item/commandExecution/requestApproval", params: { command: "pwd" } });
    await ctx.onEvent("output", { text: "Approved" });
    return { status: "succeeded" };
  };
  const running = f.service.runTeam(input);
  let approvals = [];
  for (let index = 0; index < 100 && !approvals.length; index++) {
    approvals = (await f.service.teamApprovals(input.run)).approvals;
    if (!approvals.length) await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(approvals.length, 1);
  await assert.rejects(f.service.resolveTeamApproval("different-run", approvals[0].id, "accept"), /no longer active/);
  await f.service.resolveTeamApproval(input.run, approvals[0].id, "accept");
  assert.deepEqual(await running, { reply: "Approved" });
  assert.deepEqual(received, { decision: "accept" });
  assert.deepEqual((await f.service.teamApprovals(input.run)).approvals, []);
});
test("event reads batch nearby output while preserving every delta", async t => {
  const f = await fixture(t); f.service.turns.gated = false;
  const { session } = await f.request("conversations.create");
  const binding = { provider: "codex", owner: "account", generation: 1, method: "subscription" };
  const turn = f.service.state.startTurn(session.key, "member", binding, "batched-output", { input: [{ type: "text", text: "fixture" }] });
  const reading = f.request("events.read", { conversation: session.key, after: 0, waitMs: 500 });
  while (!f.service.turns.listenerCount("event")) await new Promise(resolve => setTimeout(resolve, 1));
  f.service.state.event(turn.id, "output", { text: "Hello" });
  f.service.turns.emit("event", { conversation: session.key });
  await new Promise(resolve => setTimeout(resolve, 5));
  f.service.state.event(turn.id, "output", { text: " world" });
  f.service.turns.emit("event", { conversation: session.key });
  const result = await reading;
  assert.deepEqual(result.events.map(row => row.payload.text), ["Hello", " world"]);
  assert.equal(result.cursor, result.events.at(-1).id);
});
test("runtime refuses forged actor or lease purpose and stops using a changed generation", async t => {
  const f = await fixture(t); f.service.turns.gated = false;
  await f.request("conversations.create");
  await assert.rejects(f.service.handle({ actor: "intruder", lease: "lease-0", operation: "conversations.list" }), /authority mismatch/);
  await assert.rejects(f.service.handle({ actor: "member", lease: "lease-0", operation: "turns.start" }), /authority mismatch/);
  const context = await f.service.execution("member", "lease-0", "event-read");
  const prior = f.leases.get("lease-0"); f.leases.set("lease-0", { ...prior, binding: { ...prior.binding, generation: 2 } });
  await assert.rejects(context.revalidate(), /binding changed/);
});
test("conversation model and reasoning overrides persist, affect the next turn, and can be cleared", async t => {
  const f = await fixture(t); f.service.turns.gated = false;
  const { session } = await f.request("conversations.create");
  await f.request("conversations.update", { conversation: session.key, patch: { model: "fixture", effort: "high" } });
  const listed = (await f.request("conversations.list")).sessions[0];
  assert.equal(listed.thinkingLevel, "high");
  const turn = await f.request("turns.start", { conversation: session.key, requestId: "reasoned", input: [{ type: "text", text: "fixture" }], effort: "low" });
  await f.service.turns.active.get(turn.id)?.done;
  assert.equal(f.contexts[0].effort, "high", "browser turn input cannot override the saved reasoning policy");
  const receipt = JSON.parse(f.service.state.db.prepare("SELECT input FROM turns WHERE id=?").get(turn.id).input);
  assert.equal(receipt.model, "fixture"); assert.equal(receipt.effort, "high");
  await f.request("conversations.update", { conversation: session.key, patch: { model: null, effort: null } });
  const cleared = (await f.request("conversations.list")).sessions[0];
  assert.equal(cleared.modelOverride, undefined); assert.equal(cleared.thinkingLevel, undefined);
});
test("subscription readiness never silently accepts API-key native login", async () => {
  const accounts = new NativeAccounts({});
  for (const [provider, stdout, stderr, expected] of [
    ["codex", "", "Logged in using ChatGPT", true], ["codex", "", "Logged in using an API key", false],
    ["claude", JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }), "", true],
    ["claude", JSON.stringify({ loggedIn: true, authMethod: "api_key" }), "", false],
  ]) {
    const status = await accounts.status({ binding: { provider, method: "subscription" } }, { exec: async () => ({ stdout, stderr }) });
    assert.equal(status.ready, expected);
  }
});

test("review verifies native credentials, background authority and live admin role before releasing a hold", async t => {
  const f = await fixture(t), job = automation();
  f.service.state.putJob(job, { hold: "native-connection-required" }); f.service.turns.gated = false;
  const foreground = f.service.authorize;
  const background = [];
  f.service.authorize = async selection => {
    if (typeof selection !== "object") return foreground(selection);
    background.push(selection);
    return { actor: selection.actor, actorRole: "admin", connection: selection.connection,
      binding: { owner: selection.connection, provider: selection.provider, method: selection.method, generation: selection.generation },
      model: selection.model, policy: selection.policy, background: true, authorityGeneration: 1 };
  };
  const input = { id: job.id, requestId: "review-job", expectedRevision: f.service.state.job(job.id).source_hash,
    missedRunPolicy: "skip", overlap: "forbid", executionPolicy: { sandbox: "read-only", approval: "on-request" } };
  f.service.accounts.status = async () => ({ ready: false });
  await assert.rejects(f.request("jobs.review", input, "admin"), /native sign-in/);
  assert.ok(f.service.state.job(job.id).hold); assert.equal(f.calls(), 0);
  f.service.accounts.status = async () => {
    for (const [key, lease] of f.leases) f.leases.set(key, { ...lease, actorRole: "user" });
    return { ready: true };
  };
  await assert.rejects(f.request("jobs.review", input, "admin"), /binding changed/);
  assert.ok(f.service.state.job(job.id).hold);
  f.service.accounts.status = async () => ({ ready: true });
  assert.equal((await f.request("jobs.review", input, "admin")).accepted, true);
  assert.equal(f.service.state.job(job.id).hold, null); assert.equal(f.calls(), 0);
  assert.ok(background.every(row => row.job === job.id && row.actor === "admin" && row.policy.sandbox === "read-only"));
  assert.deepEqual(f.service.state.job(job.id).definition.connection, { owner: "account", provider: "codex", generation: 1, method: "subscription" });
});
