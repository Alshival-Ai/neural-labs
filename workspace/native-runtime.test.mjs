import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NativeState, canonical, digest } from "./native/state.mjs";
import { exportPreservation, importPreservation, projectPreservation, verifyProjection, activatePreservation, RECORD_CATEGORIES, TREE_CATEGORIES } from "./native/migration.mjs";
import { calendarFiles, cronExpression, dueOccurrence, NativeScheduler, occurrenceKey } from "./native/schedules.mjs";

const binding = { provider: "codex", owner: "member-1", generation: 1, method: "subscription" };
function job(id = "job-1", extra = {}) {
  return { id, name: "Fixture job", enabled: true, connection: binding, payload: { kind: "agentTurn", message: "Fixture prompt" },
    schedule: { kind: "every", everyMs: 60_000, anchorMs: 0 }, ...extra };
}
async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-state-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function database(t, filename = ":memory:") {
  const state = new NativeState(filename);
  t.after(() => state.close());
  return state;
}
async function preservationFixture(t, chatResetPolicy = "reset-team-pilot") {
  const root = await temporary(t), trees = {};
  for (const category of TREE_CATEGORIES) {
    trees[category] = path.join(root, category);
    await mkdir(trees[category]);
  }
  for (const [category, count] of [["teamSkills", 12], ["personalSkills", 1], ["drafts", 27]]) {
    for (let index = 0; index < count; index++) {
      const directory = path.join(trees[category], `package-${index}`);
      await mkdir(directory);
      await writeFile(path.join(directory, "SKILL.md"), `---\nname: skill-${index}\n---\nFixture instructions\n`);
      await writeFile(path.join(directory, "state.bin"), Buffer.from([0, 255, index]));
      await writeFile(path.join(directory, ".neural-labs.json"), JSON.stringify({ ownerUserId: "member-1", enabled: index % 2 === 0, collaborators: ["member-2"] }));
    }
  }
  const records = Object.fromEntries(RECORD_CATEGORIES.map(category => [category, []]));
  records.jobs = Array.from({ length: 19 }, (_, index) => ({ key: `job-${index}`, value: job(`job-${index}`, {
    enabled: index % 2 === 0, ...(index === 1 ? { declarationKey: "neural-labs-manual:request" } : {}),
    ...(index === 2 ? { payload: { kind: "heartbeat" } } : {}),
    ...(index === 3 ? { payload: { kind: "futureUnknownPayload" } } : {}),
    ...(index === 4 ? { schedule: { kind: "at", at: "2025-01-01T00:00:00Z" }, state: { lastRunAtMs: 1 } } : {}),
  }) }));
  records.receipts = Array.from({ length: 124 }, (_, index) => ({ key: `receipt-${index}`, value: { jobId: `job-${index % 19}`, status: "ok", runAtMs: index, summary: "Fixture history" } }));
  records.scratch = Array.from({ length: 3 }, (_, index) => ({ key: `scratch-${index}`, value: { requestId: `request-${index}`, childId: index === 0 ? "job-1" : `missing-child-${index}`, checkpoint: { preserved: true } } }));
  records.proposals = Array.from({ length: 20 }, (_, index) => ({ key: `proposal-${index}`, value: { status: "pending", revision: index, content: "Fixture proposal" } }));
  records.automation_subscriptions = [{ key: "member-1/job-0", value: { user_id: "member-1", job_id: "job-0", events: ["success"], channels: ["email"] } }];
  records.notification_deliveries = [{ key: "event/user/email", value: { status: "unknown", attempts: 1 } }];
  records.notification_preferences = [{ key: "member-1", value: { session_key: "obsolete-chat", email: true } }];
  const bundle = path.join(root, "bundle"), destination = path.join(root, "retained");
  const exported = await exportPreservation({ workspace: "workspace-1", trees, records, destination: bundle, chatResetPolicy });
  return { root, trees, records, bundle, destination, exported };
}

test("preservation imports the pilot baseline without activating jobs, losing records or altering originals", async t => {
  const fixture = await preservationFixture(t), state = database(t);
  const input = { source: fixture.bundle, destination: fixture.destination, state, workspace: "workspace-1", expectedId: fixture.exported.id };
  const report = await importPreservation(input);
  assert.equal(report.inventory.teamSkills.packages, 12);
  assert.equal(report.inventory.personalSkills.packages, 1);
  assert.equal(report.inventory.drafts.packages, 27);
  for (const [key, count] of [["jobs", 19], ["receipts", 124], ["scratch", 3], ["proposals", 20], ["automation_subscriptions", 1]]) assert.equal(report.inventory[key], count);
  assert.equal(report.activationReady, false);
  assert.equal(state.metadata("scheduling"), "disabled");
  assert.equal(state.metadata("delivery"), "disabled");
  assert.equal(state.job("job-1").classification, "manual-helper");
  assert.equal(state.job("job-2").classification, "system");
  assert.equal(state.job("job-3").classification, "unsupported");
  assert.equal(state.job("job-4").completed, true);
  for (const row of fixture.records.jobs) {
    assert.deepEqual(state.job(row.value.id).definition, row.value);
    assert.equal(state.job(row.value.id).enabled, row.value.enabled);
    assert.ok(state.job(row.value.id).hold);
  }
  assert.deepEqual(await importPreservation(input), report);
  assert.equal(state.db.prepare("SELECT count(*) AS count FROM jobs").get().count, 19);
  assert.deepEqual(await readFile(path.join(fixture.destination, "drafts/package-2/state.bin")), Buffer.from([0, 255, 2]));
  assert.deepEqual(await readFile(path.join(fixture.trees.drafts, "package-2/state.bin")), Buffer.from([0, 255, 2]));
  const pref = state.db.prepare("SELECT payload FROM retained_records WHERE category='notification_preferences'").get();
  assert.equal(JSON.parse(pref.payload).session_key, "obsolete-chat", "chat references are evidence, never silently rewritten by import");
});

test("tampered blobs and cross-workspace archives fail before native import", async t => {
  const fixture = await preservationFixture(t), state = database(t);
  const input = { source: fixture.bundle, destination: fixture.destination, state, workspace: "workspace-2", expectedId: fixture.exported.id };
  await assert.rejects(importPreservation(input), /workspace/);
  input.workspace = "workspace-1";
  const manifest = JSON.parse(await readFile(path.join(fixture.bundle, "manifest.json")));
  const file = manifest.files.find(row => row.type === "file");
  await writeFile(path.join(fixture.bundle, "blobs", file.sha256), "changed");
  await assert.rejects(importPreservation(input), /hash/);
  assert.equal(state.db.prepare("SELECT count(*) AS count FROM migrations").get().count, 0);
});

test("interrupted import resumes identical files but does not overwrite conflicting files", async t => {
  const fixture = await preservationFixture(t), state = database(t);
  await mkdir(path.join(fixture.destination, "teamSkills/package-0"), { recursive: true });
  const target = path.join(fixture.destination, "teamSkills/package-0/SKILL.md");
  await writeFile(target, "Existing new user work");
  const input = { source: fixture.bundle, destination: fixture.destination, state, workspace: "workspace-1", expectedId: fixture.exported.id };
  await assert.rejects(importPreservation(input), /conflicts/);
  assert.equal(await readFile(target, "utf8"), "Existing new user work");
  assert.equal(state.db.prepare("SELECT phase FROM migrations").get().phase, "copying");
  // Test fixture simulates an operator restoring the correct retained file.
  await writeFile(target, await readFile(path.join(fixture.trees.teamSkills, "package-0/SKILL.md")));
  assert.equal((await importPreservation(input)).preservationVerified, true);
});

test("source links, destination links and traversal manifests are rejected", async t => {
  const fixture = await preservationFixture(t), state = database(t);
  await mkdir(fixture.destination);
  await symlink(fixture.trees.teamSkills, path.join(fixture.destination, "teamSkills"));
  const input = { source: fixture.bundle, destination: fixture.destination, state, workspace: "workspace-1", expectedId: fixture.exported.id };
  await assert.rejects(importPreservation(input), /directories|links/);
  await symlink("/etc/passwd", path.join(fixture.trees.teamSkills, "external"));
  await assert.rejects(exportPreservation({ workspace: "workspace-1", trees: fixture.trees, records: fixture.records,
    destination: path.join(fixture.root, "bad-export"), chatResetPolicy: "preserve" }), /Unsupported filesystem/);
  const manifest = JSON.parse(await readFile(path.join(fixture.bundle, "manifest.json")));
  manifest.files[0].path = "../escape";
  const raw = canonical(manifest);
  await writeFile(path.join(fixture.bundle, "manifest.json"), raw);
  await assert.rejects(importPreservation({ ...input, expectedId: digest(raw) }), /path/);
});

test("preservation requires every collection and an explicit workspace chat policy", async t => {
  const root = await temporary(t);
  await assert.rejects(exportPreservation({ workspace: "fixture", trees: {}, records: {}, destination: path.join(root, "bundle") }), /chat-reset/);
  await assert.rejects(exportPreservation({ workspace: "fixture", trees: {}, records: {}, destination: path.join(root, "bundle"), chatResetPolicy: "preserve" }), /Complete preservation/);
});

test("durable occurrence claims prevent duplicates across connections and retain uncertain workflow locks", async t => {
  const root = await temporary(t), filename = path.join(root, "state.sqlite3");
  const first = database(t, filename), second = database(t, filename);
  first.putJob(job()); first.setMetadata("scheduling", "enabled");
  const input = { jobId: "job-1", occurrence: "every:60000", actor: "member-1", connection: binding };
  const claim = first.claim(input);
  assert.equal(claim.accepted, true);
  assert.equal(second.claim(input).accepted, false);
  first.startRun(claim.id);
  assert.deepEqual(second.recoverInterrupted(), { runs: 1, turns: 0 });
  assert.equal(second.claim(input).previous.status, "unknown");
  assert.throws(() => second.claim({ ...input, occurrence: "every:120000" }), /uncertain/);
  assert.throws(() => second.claim({ ...input, actor: "another-member" }), /binding/);
  assert.throws(() => second.startRun(claim.id), /again/);
});

test("manual runs preserve scheduled binding, disabled jobs and completed at jobs never run on schedule", t => {
  const state = database(t); state.setMetadata("scheduling", "enabled");
  state.putJob(job("disabled", { enabled: false }));
  const other = { ...binding, owner: "member-2", provider: "claude" };
  assert.throws(() => state.claim({ jobId: "disabled", occurrence: "at:1", actor: "member-1", connection: binding }), /disabled/);
  const manual = state.claim({ jobId: "disabled", occurrence: "manual:request", actor: "member-2", connection: other, manual: true });
  state.finishRun(manual.id, "succeeded");
  assert.deepEqual(state.job("disabled").definition.connection, binding);
  assert.equal(state.job("disabled").enabled, false);
  state.putJob(job("once", { schedule: { kind: "at", at: "2026-09-01T00:00:00Z" } }));
  const once = state.claim({ jobId: "once", occurrence: "at:1", actor: "member-1", connection: binding });
  state.finishRun(once.id, "succeeded");
  assert.throws(() => state.claim({ jobId: "once", occurrence: "at:2", actor: "member-1", connection: binding }), /completed/);
  assert.equal(state.checkpoint("once", "cursor", { next: 1 }), 1);
  assert.throws(() => state.checkpoint("once", "cursor", { next: 2 }), /revision/);
});

test("four independent jobs launch concurrently and a saved workflow lock serializes only that workflow", async t => {
  const state = database(t); state.setMetadata("scheduling", "enabled");
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const started = [];
  const scheduler = new NativeScheduler({ state, authorize: async ({ job }) => ({ actor: "member-1", connection: job.definition.connection, revalidate: async () => {} }),
    execute: async ({ job }) => { started.push(job.id); await gate; return { status: "succeeded", result: {} }; } });
  for (let index = 0; index < 4; index++) state.putJob(job(`job-${index}`));
  await Promise.all(Array.from({ length: 4 }, (_, index) => scheduler.launch(`job-${index}`, "every:1")));
  assert.equal(started.length, 4);
  state.putJob(job("linked-a", { workflowLock: "shared-workflow" }));
  state.putJob(job("linked-b", { workflowLock: "shared-workflow" }));
  await scheduler.launch("linked-a", "every:1");
  await assert.rejects(scheduler.launch("linked-b", "every:1"), /Workflow/);
  release(); await scheduler.drain();
  assert.equal(state.db.prepare("SELECT count(*) AS count FROM occurrences WHERE status='succeeded'").get().count, 5);
});

test("lost execution responses are unknown and never replayed", async t => {
  const state = database(t); state.setMetadata("scheduling", "enabled"); state.putJob(job());
  let executions = 0;
  const scheduler = new NativeScheduler({ state, authorize: async () => ({ actor: "member-1", connection: binding, revalidate: async () => {} }),
    execute: async () => { executions++; throw new Error("private provider response"); } });
  await scheduler.launch("job-1", "every:1"); await scheduler.drain();
  const duplicate = await scheduler.launch("job-1", "every:1");
  assert.equal(duplicate.previous.status, "unknown");
  assert.equal(executions, 1);
  assert.ok(!duplicate.previous.result.includes("private"));
});

test("an automation edited while authorization is pending is never launched under stale policy", async t => {
  const state = database(t); state.setMetadata("scheduling", "enabled"); state.putJob(job());
  const scheduler = new NativeScheduler({ state, authorize: async () => {
    const changed = job("job-1", { payload: { kind: "agentTurn", message: "Changed work" } });
    state.db.prepare("UPDATE jobs SET definition=?,source_hash=? WHERE id='job-1'").run(canonical(changed), digest(canonical(changed)));
    return { actor: "member-1", connection: binding, revalidate: async () => {} };
  }, execute: async () => assert.fail("stale definition must not execute") });
  await assert.rejects(scheduler.launch("job-1", "every:1"), /changed during/);
  assert.equal(state.db.prepare("SELECT count(*) AS count FROM occurrences").get().count, 0);
});

test("native conversations bind actor, provider, owner and generation; reconnect does not restart work", t => {
  const state = database(t);
  const conversation = state.createConversation("member-1", binding);
  const first = state.startTurn(conversation, "member-1", binding, "request-1", { text: "hello" });
  assert.equal(state.startTurn(conversation, "member-1", binding, "request-1", { text: "hello" }).accepted, false);
  assert.throws(() => state.startTurn(conversation, "member-1", binding, "request-2", { text: "second" }), /active/);
  const other = state.createConversation("member-1", binding);
  assert.equal(state.startTurn(other, "member-1", binding, "request-3", {}).accepted, true);
  const cursor = Number(state.event(first.id, "output", { text: "reply" }));
  assert.equal(state.events(conversation, "member-1", binding, 0)[0].payload.text, "reply");
  assert.equal(state.events(conversation, "member-1", binding, cursor).length, 0);
  assert.throws(() => state.events(conversation, "member-2", binding), /binding/);
  assert.equal(state.conversation(conversation, "member-1", { ...binding, generation: 2 }).id, conversation);
  for (const changed of [{ ...binding, owner: "shared" }, { ...binding, provider: "claude" }, { ...binding, method: "api-key" }]) {
    assert.throws(() => state.conversation(conversation, "member-1", changed), /binding/);
  }
});

test("anchored intervals, one-time and event triggers skip missed work and deduplicate callback identities", () => {
  const active = { definition: job(), enabled: true, classification: "automation", hold: null, completed: false };
  assert.equal(dueOccurrence(active, { now: 180001, previousCheck: 180001 }), null);
  assert.equal(dueOccurrence(active, { now: 180001, previousCheck: 179000 }), "every:180000");
  const once = { ...active, definition: job("once", { schedule: { kind: "at", at: "2026-09-01T00:00:00Z" } }) };
  const at = Date.parse(once.definition.schedule.at);
  assert.equal(dueOccurrence(once, { now: at + 1, previousCheck: at - 1 }), `at:${at}`);
  assert.equal(dueOccurrence(once, { now: at + 1 }), null);
  assert.equal(dueOccurrence({ ...once, completed: true }, { now: at }), null);
  for (const kind of ["process", "stream"]) {
    const triggered = { ...active, definition: job("event", { schedule: { kind, source: "source-1" } }) };
    const event = { kind, source: "source-1", generation: "generation-1", id: "event-1", type: "exit" };
    assert.equal(dueOccurrence(triggered, { now: at, event }), `${kind}:generation-1:event-1`);
    assert.equal(dueOccurrence(triggered, { now: at, event: { ...event, source: "source-2" } }), null);
  }
});

test("calendar files use timezone groups and fixed job IDs without prompts or shell injection", () => {
  const rows = ["America/Chicago", "Europe/London"].map((tz, index) => ({ id: `job-${index}`, enabled: true, classification: "automation",
    definition: job(`job-${index}`, { schedule: { kind: "cron", expr: "30 3 * * 0", tz }, payload: { message: "secret prompt $(touch /tmp/bad)" } }) }));
  const files = calendarFiles(rows);
  assert.equal(Object.keys(files).length, 2);
  assert.match(files["America/Chicago"], /^CRON_TZ=America\/Chicago\n30 3 \* \* 0 .*runner\.mjs job-0\n$/);
  assert.ok(!canonical(files).includes("secret"));
  assert.throws(() => calendarFiles([{ ...rows[0], id: "job;touch bad" }]), /identity/);
  for (const expr of ["* * * * *\n* * * * * bad", "60 * * * *", "* 24 * * *", "@reboot", "*/0 * * * *", "* * * * *;bad"]) assert.throws(() => cronExpression(expr));
  assert.equal(cronExpression("*/5 0-23 * * 1,3,5"), "*/5 0-23 * * 1,3,5");
  // Both sides of a DST fall-back have different occurrence identities. Actual
  // calendar scheduling across DST still requires the pinned Supercronic test.
  assert.notEqual(occurrenceKey("cron", Date.parse("2026-11-01T01:30:00-05:00")), occurrenceKey("cron", Date.parse("2026-11-01T01:30:00-06:00")));
});


test("installed migration packages preserve permissions and all records, and verification catches later writes", async t => {
  const fixture = await preservationFixture(t), state = database(t);
  const input = { source: fixture.bundle, destination: fixture.destination, state, workspace: "workspace-1", expectedId: fixture.exported.id };
  await importPreservation(input);
  const targets = {};
  for (const category of TREE_CATEGORIES) {
    targets[category] = path.join(fixture.root, "installed-" + category);
    await mkdir(targets[category]);
  }
  const report = await projectPreservation({ ...input, targets });
  assert.equal(report.inventory.drafts.packages, 27);
  assert.equal(report.activationReady, false);
  assert.equal(state.metadata("activation"), undefined);
  assert.deepEqual(await projectPreservation({ ...input, targets }), report);
  await writeFile(path.join(targets.teamSkills, "package-0/SKILL.md"), "new user work");
  await assert.rejects(verifyProjection(input), /hash changed/);
  await assert.rejects(projectPreservation({ ...input, targets }), /conflicts/);
  assert.equal(await readFile(path.join(targets.teamSkills, "package-0/SKILL.md"), "utf8"), "new user work");
});

test("projection refuses overlapping paths and retained database tampering", async t => {
  const fixture = await preservationFixture(t), state = database(t);
  const input = { source: fixture.bundle, destination: fixture.destination, state, workspace: "workspace-1", expectedId: fixture.exported.id };
  await importPreservation(input);
  await assert.rejects(projectPreservation({ ...input, targets: { ...fixture.trees, drafts: fixture.trees.teamSkills } }), /overlap/);
  await projectPreservation({ ...input, targets: fixture.trees });
  state.db.prepare("UPDATE retained_records SET payload='{}' WHERE category='receipts'").run();
  await assert.rejects(verifyProjection(input), /integrity changed/);
});


test("activation checks live notification preservation and explicit chat policy while keeping every job held", async t => {
  const fixture = await preservationFixture(t), state = database(t);
  const input = { source: fixture.bundle, destination: fixture.destination, state, workspace: "workspace-1", expectedId: fixture.exported.id };
  await importPreservation(input);
  await projectPreservation({ ...input, targets: fixture.trees });
  const controlPlaneRecords = structuredClone(fixture.records);
  controlPlaneRecords.notification_preferences[0].value.session_key = null;
  const tables = RECORD_CATEGORIES.filter(category => category.startsWith("notification_") || category === "automation_subscriptions");
  const notificationState = digest(canonical(Object.fromEntries(tables.map(category => [category,
    controlPlaneRecords[category].map(row => digest(canonical(row.value))).sort()]))));
  const chatReceipt = { migration: fixture.exported.id, workspace: "workspace-1", chatResetPolicy: "reset-team-pilot", channelsRemoved: 1, notificationState };
  await assert.rejects(activatePreservation({ ...input, controlPlaneRecords, chatReceipt: { ...chatReceipt, workspace: "another-workspace" } }), /matching/);
  const altered = structuredClone(controlPlaneRecords); altered.notification_deliveries[0].value.status = "pending";
  await assert.rejects(activatePreservation({ ...input, controlPlaneRecords: altered, chatReceipt }), /comparison failed/);
  const result = await activatePreservation({ ...input, controlPlaneRecords, chatReceipt });
  assert.equal(result.activationReady, true); assert.equal(result.jobsHeld, 19);
  assert.equal(state.metadata("scheduling"), "disabled"); assert.equal(state.metadata("delivery"), "disabled");
  assert.equal(state.metadata("activation"), "verified");
  assert.deepEqual(await activatePreservation({ ...input, controlPlaneRecords, chatReceipt }), result);
});

test("preservation rejects reactivated one-time jobs and altered classification or holds", async t => {
  const fixture = await preservationFixture(t), state = database(t);
  const input = { source: fixture.bundle, destination: fixture.destination, state, workspace: "workspace-1", expectedId: fixture.exported.id };
  await importPreservation(input);
  await projectPreservation({ ...input, targets: fixture.trees });
  for (const [column, value, id] of [["completed", 0, "job-4"], ["classification", "automation", "job-1"], ["hold", "different-policy", "job-0"]]) {
    const original = state.db.prepare(`SELECT ${column} AS value FROM jobs WHERE id=?`).get(id).value;
    state.db.prepare(`UPDATE jobs SET ${column}=? WHERE id=?`).run(value, id);
    await assert.rejects(verifyProjection(input), /automation changed/);
    state.db.prepare(`UPDATE jobs SET ${column}=? WHERE id=?`).run(original, id);
  }
  assert.equal((await verifyProjection(input)).inventory.jobs, 19);
});

test("customer preservation retains chat references and only stages scheduling for host commit", async t => {
  const fixture = await preservationFixture(t, "preserve"), state = database(t);
  const input = { source: fixture.bundle, destination: fixture.destination, state, workspace: "workspace-1", expectedId: fixture.exported.id };
  await importPreservation(input); await projectPreservation({ ...input, targets: fixture.trees });
  const tables = RECORD_CATEGORIES.filter(category => category.startsWith("notification_") || category === "automation_subscriptions");
  const notificationState = digest(canonical(Object.fromEntries(tables.map(category => [category, fixture.records[category].map(row => digest(canonical(row.value))).sort()]))));
  const chatReceipt = { workspace: input.workspace, migration: input.expectedId, chatResetPolicy: "preserve", notificationState, channelsRemoved: 0 };
  const afterCommit = { scheduling: "enabled", delivery: "disabled" };
  await assert.rejects(activatePreservation({ ...input, controlPlaneRecords: fixture.records, chatReceipt: { ...chatReceipt, channelsRemoved: 1 }, afterCommit }), /matching/);
  const result = await activatePreservation({ ...input, controlPlaneRecords: fixture.records, chatReceipt, afterCommit });
  assert.equal(result.activationReady, true); assert.equal(result.jobsHeld, 19);
  assert.equal(state.metadata("scheduling"), "disabled");
  assert.deepEqual(JSON.parse(state.metadata("maintenance")), afterCommit);
  await assert.rejects(activatePreservation({ ...input, controlPlaneRecords: fixture.records, chatReceipt }), /evidence changed/);
});

test("operator CLI imports and verifies a real bundle with the documented sha256 argument", async t => {
  const fixture = await preservationFixture(t);
  const script = fileURLToPath(new URL("../bin/native-migration.mjs", import.meta.url));
  const db = path.join(fixture.root, "cli.sqlite"), map = path.join(fixture.root, "paths.json");
  await writeFile(map, JSON.stringify(fixture.trees));
  const args = ["--database", db, "--workspace", "workspace-1", "--sha256", fixture.exported.id];
  const run = (command, extra = []) => JSON.parse(execFileSync(process.execPath, [script, command, ...args, ...extra], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  assert.equal(run("import", ["--source", fixture.bundle, "--destination", fixture.destination]).inventory.jobs, 19);
  assert.equal(run("project", ["--source", fixture.bundle, "--path-map", map]).inventory.receipts, 124);
  assert.equal(run("verify").recordsVerified, fixture.exported.inventory.jobs + fixture.exported.inventory.receipts + fixture.exported.inventory.scratch + fixture.exported.inventory.proposals + 3);
});
