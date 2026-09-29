import test from "node:test";
import assert from "node:assert/strict";
import { NativeState, canonical } from "./native/state.mjs";
import { NativeJobs } from "./native/jobs.mjs";

const grant = { actor: "admin", actorRole: "admin", binding: { owner: "native-account", provider: "codex", generation: 2, method: "subscription" }, model: "native-model" };
function fixture(t, extra = {}, options = {}) {
  const state = new NativeState(":memory:"); t.after(() => state.close());
  const definition = { id: "retained-job", name: "Retained", enabled: false,
    schedule: { kind: "at", at: "2025-01-01T00:00:00Z" }, payload: { kind: "agentTurn", message: "Retain the original instruction and job ID" },
    state: { lastRunAtMs: 1000 }, delivery: { mode: "none" }, ...extra };
  state.putJob(definition, { hold: "native-connection-required" });
  const job = state.job(definition.id);
  const input = { id: job.id, requestId: "review-1", expectedRevision: job.source_hash, missedRunPolicy: "skip", overlap: "forbid",
    executionPolicy: { sandbox: "read-only", approval: "on-request" } };
  const jobs = new NativeJobs({ state, authorizeReview: async () => async () => {}, ...options });
  return { state, jobs, input, job };
}
test("review keeps identity, paused/completed state, original definitions and idempotent receipt", async t => {
  const f = fixture(t);
  const result = await f.jobs.review(grant, f.input);
  assert.equal(result.accepted, true);
  const current = f.state.job(f.job.id);
  assert.equal(current.hold, null); assert.equal(current.enabled, false); assert.equal(current.completed, true);
  assert.deepEqual(current.definition.payload, f.job.definition.payload);
  assert.deepEqual(current.definition.schedule, f.job.definition.schedule);
  assert.deepEqual(current.definition.connection, grant.binding);
  assert.equal(current.definition.actor, grant.actor);
  assert.equal(f.state.db.prepare("SELECT count(*) n FROM occurrences").get().n, 0);
  const receipt = f.state.db.prepare("SELECT * FROM job_reviews").get();
  assert.equal(receipt.before_definition, canonical(f.job.definition));
  assert.equal(receipt.after_definition, canonical(current.definition));
  assert.equal((await f.jobs.review(grant, f.input)).accepted, false);
  await assert.rejects(f.jobs.review(grant, { ...f.input, overlap: "allow" }), /conflicts/);
});
test("review rejects non-admins, unsupported policies, uncertain runs and system records", async t => {
  const f = fixture(t);
  await assert.rejects(f.jobs.review({ ...grant, actorRole: "user" }, f.input), /Administrator/);
  for (const hold of ["uncertain-legacy-run", "system-requires-review", "deleted", "unsupported-trigger"]) {
    f.state.db.prepare("UPDATE jobs SET hold=?").run(hold);
    await assert.rejects(f.jobs.review(grant, f.input), /operator review/);
  }
  for (const extra of [{ trigger: { script: "fixture" } }, { failureAlert: { after: 2 } }, { payload: { kind: "agentTurn", message: "fixture", toolsAllow: ["exec"] } },
    { sessionTarget: "main" }, { state: { runningAtMs: 1 } }, { schedule: { kind: "cron", expr: "0 * * * *", staggerMs: 1000 } }]) {
    const g = fixture(t, extra);
    await assert.rejects(g.jobs.review(grant, g.input), /policy|policies|reconciliation/);
    assert.equal(g.state.job(g.job.id).hold, "native-connection-required");
  }
});
test("background denial, changed definition, credential revocation and unknown outcomes keep the hold", async t => {
  const denied = fixture(t, {}, { authorizeReview: async () => { throw new Error("Background denied"); } });
  await assert.rejects(denied.jobs.review(grant, denied.input), /Background denied/);
  const changed = fixture(t);
  changed.jobs.authorizeReview = async () => {
    await changed.jobs.update(grant, { id: changed.job.id, expectedRevision: changed.job.source_hash, patch: { enabled: false } });
    changed.state.db.prepare("UPDATE jobs SET source_hash='another-revision'").run();
    return async () => {};
  };
  await assert.rejects(changed.jobs.review(grant, changed.input), /changed/);
  const revoked = fixture(t, {}, { authorizeReview: async () => async () => { throw new Error("Credential revoked"); } });
  await assert.rejects(revoked.jobs.review(grant, revoked.input), /Credential revoked/);
  const unknown = fixture(t, { enabled: true, actor: grant.actor, connection: grant.binding, state: {}, schedule: { kind: "every", everyMs: 60000, anchorMs: 0 } });
  unknown.state.db.prepare("UPDATE jobs SET hold=NULL").run(); unknown.state.setMetadata("scheduling", "enabled");
  const run = unknown.state.claim({ jobId: unknown.job.id, occurrence: "every:60000", actor: grant.actor, connection: grant.binding });
  unknown.state.finishRun(run.id, "unknown", {});
  unknown.state.db.prepare("UPDATE jobs SET hold='native-connection-required'").run();
  await assert.rejects(unknown.jobs.review(grant, unknown.input), /reconciliation/);
  for (const f of [denied, changed, revoked, unknown]) {
    assert.equal(f.state.db.prepare("SELECT count(*) n FROM job_reviews").get().n, 0);
    assert.equal(f.state.job(f.job.id).hold, "native-connection-required");
  }
});
test("an uncertain response after committing review retries without rewriting the decision", async t => {
  let refreshes = 0;
  const f = fixture(t, {}, { changed: async () => { if (++refreshes === 1) throw new Error("Refresh unavailable"); } });
  await assert.rejects(f.jobs.review(grant, f.input), /Refresh unavailable/);
  assert.equal(f.state.job(f.job.id).hold, null);
  assert.equal((await f.jobs.review(grant, f.input)).accepted, false);
  assert.equal(f.state.db.prepare("SELECT count(*) n FROM job_reviews").get().n, 1);
});
