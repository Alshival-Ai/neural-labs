import test from "node:test";
import assert from "node:assert/strict";
import { NativeState } from "./native/state.mjs";
import { calendarOccurrence, NativeTriggerLoop } from "./native/trigger-loop.mjs";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("calendar process loss becomes unready and restarts with backoff without replaying claims", async t => {
  const state = new NativeState(":memory:"); t.after(() => state.close());
  const root = await mkdtemp(path.join(os.tmpdir(), "native-calendar-supervisor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  state.putJob({ id: "calendar", enabled: true, schedule: { kind: "cron", expr: "* * * * *", tz: "UTC" } });
  state.setMetadata("scheduling", "enabled");
  let now = 10000, launched = 0;
  const children = [];
  const loop = new NativeTriggerLoop({ state, root, now: () => now,
    scheduler: { launch: async () => { launched++; } },
    spawnProcess: () => {
      const child = new EventEmitter(); child.stderr = { resume() {} }; child.kill = () => child.emit("exit", 0);
      children.push(child); return child;
    } });
  loop.closed = false;
  await loop.refresh(); assert.equal(loop.status().ready, true); assert.equal(children.length, 1);
  children[0].emit("exit", 1); assert.equal(loop.status().ready, false);
  loop.tick(); await Promise.all(loop.pending); assert.equal(children.length, 1);
  now += 2000; loop.tick(); await Promise.all(loop.pending);
  assert.equal(children.length, 2); assert.equal(loop.status().ready, true); assert.equal(launched, 0);
  state.setMetadata("scheduling", "disabled"); await loop.refresh();
  assert.equal(loop.processes.size, 0);
});

test("calendar claims distinguish repeated DST minutes and skip nonexistent local time", () => {
  const schedule = { kind: "cron", expr: "30 1 * * *", tz: "America/Chicago" };
  const first = calendarOccurrence(schedule, Date.parse("2026-11-01T06:30:00Z"));
  const second = calendarOccurrence(schedule, Date.parse("2026-11-01T07:30:00Z"));
  assert.ok(first); assert.ok(second); assert.notEqual(first, second);
  assert.equal(calendarOccurrence({ ...schedule, expr: "30 2 * * *" }, Date.parse("2026-03-08T08:30:00Z")), null);
  assert.ok(calendarOccurrence({ ...schedule, expr: "*/10 * * * *", tz: "Asia/Kolkata" }, Date.parse("2026-01-01T00:00:00Z")));
});
test("trigger admission is gated, anchored, concurrent and does not replay skip-policy downtime", async t => {
  let now = 12000; const launched = [];
  const state = new NativeState(":memory:"); t.after(() => state.close());
  for (let index = 0; index < 4; index++) state.putJob({ id: `job-${index}`, enabled: true, schedule: { kind: "every", everyMs: 1000, anchorMs: 0 } });
  const loop = new NativeTriggerLoop({ state, scheduler: { launch: async (id, occurrence) => launched.push([id, occurrence]) }, root: "/fixture", now: () => now });
  loop.tick(); assert.equal(launched.length, 0);
  loop.closed = false; state.setMetadata("scheduling", "enabled"); now = 13000;
  loop.tick(); await Promise.all(loop.pending); assert.equal(launched.length, 4);
  assert.ok(launched.every(([, occurrence]) => occurrence === "every:13000"));
  // On process restart previousCheck starts at now; historical slots are not
  // recovered from a persisted last-check pointer when policy is skip.
  now = 18500;
  const restarted = new NativeTriggerLoop({ state, scheduler: loop.scheduler, root: "/fixture", now: () => now });
  restarted.closed = false; restarted.tick(); await Promise.all(restarted.pending);
  assert.equal(launched.length, 4);
});
