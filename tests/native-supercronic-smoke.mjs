import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeState } from "../workspace/native/state.mjs";
import { NativeScheduler } from "../workspace/native/schedules.mjs";
import { NativeTriggerLoop } from "../workspace/native/trigger-loop.mjs";
const binary = process.argv[2];
if (!binary?.startsWith("/")) throw new Error("Supply the downloaded pinned Supercronic binary");
const root = await mkdtemp(path.join(tmpdir(), "native-cron-"));
const state = new NativeState(path.join(root, "fixture.sqlite"));
const connection = { provider: "codex", owner: "fixture", generation: 1, method: "subscription" };
let executions = 0, loop;
try {
  state.putJob({ id: "fixture-calendar", enabled: true, connection, schedule: { kind: "cron", expr: "* * * * *", tz: "Pacific/Kiritimati" } });
  state.setMetadata("scheduling", "enabled");
  const scheduler = new NativeScheduler({ state, authorize: async () => ({ actor: "fixture", connection, revalidate: async () => {} }),
    execute: async () => { executions++; return { status: "succeeded", result: { fixture: true } }; } });
  loop = new NativeTriggerLoop({ state, scheduler, root, supercronic: binary,
    runnerPaths: { node: process.execPath, runner: fileURLToPath(new URL("../workspace/native/runner.mjs", import.meta.url)) } });
  await loop.start();
  console.log("Waiting for one real calendar occurrence in the isolated fixture");
  const deadline = Date.now() + 70000;
  while (!executions && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(executions, 1); await scheduler.drain();
  const receipt = state.db.prepare("SELECT * FROM occurrences").get();
  assert.equal(receipt.status, "succeeded");
  assert.equal((await scheduler.launch("fixture-calendar", receipt.occurrence)).accepted, false);
  assert.equal(executions, 1);
  await loop.close(); loop = null;
  console.log("Pinned Supercronic, timezone crontab, fixed socket runner, durable receipt and duplicate prevention passed");
} finally { if (loop) await loop.close(); state.close(); await rm(root, { recursive: true, force: true }); }
