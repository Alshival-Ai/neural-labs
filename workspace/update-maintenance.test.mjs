import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { UpdateMaintenance, prepareProbation } from "./update-maintenance.mjs";
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "update-maintenance-")); t.after(() => rm(root, { force: true, recursive: true }));
  let enabled = true;
  const configPath = path.join(root, "config.json"); await writeFile(configPath, "{}");
  const execute = async (_cmd, args) => { enabled = args[1] === "unset" || args[3] === "true"; };
  const calls = [], jobs = [{ id: "on", enabled: true, state: {} }, { id: "off", enabled: false, state: {} }];
  const request = async (method, input) => {
    calls.push([method, input]);
    if (method === "cron.status") return { enabled };
    if (method === "status") return { tasks: { active: 0 } };
    if (method === "sessions.list") return { sessions: [{ hasActiveRun: false, activeRunIds: [] }], hasMore: false };
    if (method === "cron.list") return { jobs, hasMore: false };
    if (method === "cron.update") jobs.find(j => j.id === input.id).enabled = input.patch.enabled;
    return {};
  };
  return { root, request, calls, jobs, configPath, execute };
}
test("every open terminal, editor, write and run blocks idle admission", async t => {
  const data = await fixture(t), manager = new UpdateMaintenance(data);
  for (const kind of ["terminals", "editors", "writes", "fileJobs"]) {
    manager.localActivity = () => ({ [kind]: 1 }); assert.equal((await manager.activity()).idle, false);
  }
  manager.localActivity = () => ({ terminals: 0 }); assert.equal((await manager.activity()).idle, true);
  data.jobs[0].state.runningAtMs = Date.now(); assert.equal((await manager.activity()).idle, false);
});
test("pause ledger survives restart and preserves every job enabled setting", async t => {
  const data = await fixture(t), manager = new UpdateMaintenance(data);
  await manager.pause(); assert.equal(manager.gated, true); assert.equal((await data.request("cron.status", {})).enabled, false);
  assert.deepEqual(data.jobs.map(j => j.enabled), [true, false]);
  await new UpdateMaintenance(data).resume();
  assert.deepEqual(data.jobs.map(j => j.enabled), [true, false]);
  assert.equal(data.calls.filter(([method]) => method === "set-heartbeats").length, 2);
});
test("probation cannot activate and unknown activity schemas never mean idle", async t => {
  const data = await fixture(t);
  await assert.rejects(new UpdateMaintenance({ ...data, probation: true }).resume(), /normal restart/);
  await assert.rejects(new UpdateMaintenance({ ...data, request: async () => ({ sessions: [], jobs: [] }) }).activity(), /Unrecognized/);
});
test("pre-start probation disables all heartbeats and restores only overridden settings", async t => {
  const data = await fixture(t), calls = [];
  const agents = { defaults: { heartbeat: { every: "1h", target: "none" } }, entries: { one: { heartbeat: { every: "2h" } }, two: {} } };
  const run = args => { calls.push(args); return { status: 0, stdout: JSON.stringify(agents) }; };
  await prepareProbation({ ...data, run, probation: true });
  const edits = JSON.parse(calls.at(-1)[3]); assert.equal(edits.length, 3); assert.ok(edits.every(e => e.value.every === "0m"));
  await prepareProbation({ ...data, run, probation: false, activate: true });
  assert.ok(calls.some(a => a[1] === "unset" && a[2] === "agents.entries.two.heartbeat"));
  assert.ok(calls.some(a => a[2] === "agents.defaults.heartbeat" && a[3] === JSON.stringify(agents.defaults.heartbeat)));
});


test("disconnecting a client does not hide unfinished work from maintenance", async () => {
  const { EventEmitter } = await import("node:events");
  const { trackResponseWork } = await import("./update-maintenance.mjs");
  const response = new EventEmitter(); let active = 0, finish;
  const background = new Promise(resolve => { finish = resolve; });
  const request = trackResponseWork(response, () => background, delta => { active += delta; });
  response.emit("close");
  assert.equal(active, 1);
  finish(); await request;
  assert.equal(active, 0);
  response.emit("finish"); assert.equal(active, 0);
});
