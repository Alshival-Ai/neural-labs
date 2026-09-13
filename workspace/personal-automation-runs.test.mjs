import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PersonalAutomationRuns } from "./personal-automation-runs.mjs";
import { personalAgentId } from "./personal-openai.mjs";
import { notificationScheduler } from "./notification-scheduler.mjs";
import { validateCronAddParams, validateCronUpdateParams } from "@openclaw/gateway-protocol";

const userId = "11111111-1111-1111-1111-111111111111";
const actor = { userId, role: "admin", email: "developer@example.com" };
const input = { jobId: "original", requestId: "22222222-2222-2222-2222-222222222222", mode: "force" };
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "personal-automation-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = { id: "original", name: "Example", agentId: "main", enabled: true,
    schedule: { kind: "cron", expr: "0 8 * * *" }, sessionTarget: "main", configRevision: "original-revision",
    payload: { kind: "agentTurn", message: "Run the task", model: "openai/gpt-5.6-sol", thinking: "xhigh", toolsAllow: ["read"], timeoutSeconds: 100 },
    delivery: { mode: "none" }, scheduledToolPolicy: { version: 1, mode: "trusted" }, state: {} };
  const jobs = [original], entries = [], calls = [];
  const request = async (method, params) => {
    calls.push({ method, params });
    if (method === "cron.status") return { enabled: true };
    if (method === "cron.list") return { jobs: structuredClone(jobs), hasMore: false };
    if (method === "cron.add") { assert.equal(validateCronAddParams(params), true, JSON.stringify(validateCronAddParams.errors)); const child = { ...params, id: "child", state: {} }; jobs.push(child); return { id: child.id }; }
    if (method === "cron.update") { assert.equal(validateCronUpdateParams(params), true, JSON.stringify(validateCronUpdateParams.errors)); Object.assign(jobs.find(job => job.id === params.id), params.patch); return jobs[1]; }
    if (method === "cron.run") { jobs[1].state.runningAtMs = 1000; if (options.uncertain) throw new Error("timeout"); return { ok: true, queued: true }; }
    if (method === "cron.runs") return { entries: entries.filter(row => params.scope !== "job" || row.jobId === params.jobId).slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 200)) };
    throw new Error(`Unexpected method: ${method}`);
  };
  const accounts = { prepareRun: async (id) => { assert.equal(id, userId); if (options.disconnected) throw new Error("disconnected"); return options.wrongOwner ? "main" : personalAgentId(id); } };
  const service = new PersonalAutomationRuns({ root, request, accounts, now: () => 1000 });
  return { service, jobs, entries, calls, original, root, request, accounts };
}

test("manual execution uses the actor's account without altering the original schedule or job", async t => {
  const f = await fixture(t);
  const before = structuredClone(f.original);
  const result = await f.service.run(actor, input);
  assert.equal(result.agentId, personalAgentId(userId));
  assert.deepEqual(f.original, before);
  assert.equal(f.calls.some(row => row.method === "cron.update" && row.params.id === "original"), false);
  const child = f.jobs[1];
  assert.equal(child.enabled, false);
  assert.equal(child.sessionTarget, "isolated");
  assert.equal(child.sessionKey, undefined);
  assert.equal(child.agentId, personalAgentId(userId));
  assert.deepEqual(child.payload.toolsAllow, ["read"]);
  assert.deepEqual(child.payload.fallbacks, []);
  assert.equal(child.payload.model, before.payload.model);
  assert.equal(child.payload.timeoutSeconds, 100);
  assert.match(child.payload.message, /execution automation ID child/);
});

test("rejects disconnected accounts, wrong ownership and unauthorized callers before a scheduler mutation", async t => {
  for (const options of [{ disconnected: true }, { wrongOwner: true }]) {
    const f = await fixture(t, options);
    await assert.rejects(f.service.run(actor, input));
    assert.equal(f.calls.some(row => row.method === "cron.add"), false);
  }
  const f = await fixture(t);
  await assert.rejects(f.service.run({ ...actor, role: "guest" }, input), /membership/);
  assert.equal(f.calls.length, 0);
});

test("preserves pauses and due checks; force is explicit and does not enable the source", async t => {
  const f = await fixture(t);
  f.original.enabled = false;
  await assert.rejects(f.service.run(actor, { ...input, mode: "if-enabled" }), /paused/);
  f.original.enabled = true;
  await assert.rejects(f.service.run(actor, { ...input, mode: "due" }), /not due/);
  f.original.enabled = false;
  await f.service.run(actor, input);
  assert.equal(f.original.enabled, false);
});

test("idempotent retries and concurrent clicks cannot submit a second personal run", async t => {
  const f = await fixture(t);
  const [a, b] = await Promise.all([f.service.run(actor, input), f.service.run(actor, input)]);
  assert.deepEqual(a, b);
  assert.equal(f.calls.filter(row => row.method === "cron.run").length, 1);
  await assert.rejects(f.service.run(actor, { ...input, requestId: "33333333-3333-3333-3333-333333333333" }), /active/);
  const restarted = new PersonalAutomationRuns({ root: f.root, request: f.request, accounts: f.accounts });
  assert.deepEqual(await restarted.run(actor, input), a);
});

test("ambiguous acceptance survives restart and never retries or deletes the run", async t => {
  const f = await fixture(t, { uncertain: true });
  await assert.rejects(f.service.run(actor, input), /uncertain/);
  const restarted = new PersonalAutomationRuns({ root: f.root, request: f.request, accounts: f.accounts });
  await assert.rejects(restarted.run(actor, input), /uncertain/);
  assert.equal(f.calls.filter(row => row.method === "cron.run").length, 1);
});

test("merges history, running state and subscriber identity under the original automation", async t => {
  const f = await fixture(t);
  await f.service.run(actor, input);
  const request = f.service.schedulerRequest.bind(f.service);
  const active = await notificationScheduler(request, "job", { jobId: "original" });
  assert.equal(active.job.currentRunId, "1000");
  f.jobs[1].state = { lastRunAtMs: 1000, lastRunStatus: "ok" };
  f.entries.push({ jobId: "child", action: "finished", status: "ok", runAtMs: 1000, ts: 1500, summary: "Done" });
  const snapshot = await f.service.snapshot();
  assert.equal(snapshot.jobs.length, 1);
  assert.equal(snapshot.entries[0].jobId, "original");
  assert.match(snapshot.entries[0].summary, /developer@example.com/);
  const run = await notificationScheduler(request, "run", { jobId: "original", runId: "1000" });
  assert.deepEqual(run.run, { id: "1000", jobId: "original", name: "Example", outcome: "success", finishedAt: 1500 });
  const childRun = await f.service.notification("run", { jobId: "child", runId: "1000" });
  assert.equal(childRun.job.id, "original");
  assert.equal(childRun.run.jobId, "original");
});

test("refuses system jobs and existing scheduled runs", async t => {
  const f = await fixture(t);
  f.original.state.runningAtMs = 500;
  await assert.rejects(f.service.run(actor, input), /already running/);
  f.original.state = {};
  f.original.payload.kind = "heartbeat";
  await assert.rejects(f.service.run(actor, input), /AI task automations only/);
});

test("members run with their own account and receive only operational history", async t => {
  const f = await fixture(t);
  const member = { ...actor, role: "user" };
  const result = await f.service.run(member, input);
  assert.equal(result.agentId, personalAgentId(userId));
  f.entries.push({jobId: "child", status: "ok", summary: "private result", sessionKey: "private-session"});
  f.original.schedule = { kind: "stream", command: "private command", cwd: "/private" };
  f.original.state.lastError = "private failure";
  const snapshot = await f.service.snapshot(member);
  assert.equal(snapshot.jobs.length, 1);
  assert.deepEqual(snapshot.jobs[0].payload, {kind: "agentTurn"});
  assert.equal(snapshot.jobs[0].delivery, undefined);
  assert.equal(snapshot.jobs[0].schedule.command, undefined);
  assert.equal(snapshot.jobs[0].state.lastError, undefined);
  assert.equal(snapshot.entries[0].summary, undefined);
  assert.equal(snapshot.entries[0].sessionKey, undefined);
});
