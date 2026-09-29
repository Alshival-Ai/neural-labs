import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { readLegacyScheduler } from "./native/legacy-sqlite.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-legacy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, "legacy.sqlite");
  const db = new DatabaseSync(filename);
  db.exec(`CREATE TABLE cron_jobs (store_key TEXT,job_id TEXT,job_json TEXT,state_json TEXT,enabled INTEGER,PRIMARY KEY(store_key,job_id));
    CREATE TABLE cron_run_receipts (receipt_id TEXT PRIMARY KEY,job_id TEXT,status TEXT);
    CREATE TABLE cron_job_scratch (store_key TEXT,job_id TEXT,content TEXT,revision INTEGER,PRIMARY KEY(store_key,job_id));
    CREATE TABLE skill_workshop_proposals (proposal_id TEXT PRIMARY KEY,record_json TEXT);
    CREATE TABLE skill_workshop_proposal_events (sequence INTEGER PRIMARY KEY,proposal_id TEXT,payload_json TEXT);
    CREATE TABLE secret_store_entries (id TEXT PRIMARY KEY,secret TEXT);`);
  const job = { id: "job-1", enabled: true, payload: { kind: "agentTurn", message: "Retained fixture" }, schedule: { kind: "at", at: "2026-01-01T00:00:00Z" }, state: { lastRunAtMs: 1 } };
  db.prepare("INSERT INTO cron_jobs VALUES (?,?,?,?,?)").run("store", job.id, JSON.stringify(job), JSON.stringify({ lastRunAtMs: 100, lastStatus: "ok" }), 1);
  db.exec(`INSERT INTO cron_run_receipts VALUES ('receipt-1','job-1','completed');
    INSERT INTO cron_job_scratch VALUES ('store','job-1','checkpoint',3);
    INSERT INTO skill_workshop_proposals VALUES ('proposal-1','{"status":"pending"}');
    INSERT INTO skill_workshop_proposal_events VALUES (1,'proposal-1','{"event":"created"}');
    INSERT INTO secret_store_entries VALUES ('fixture','fixture-private-value');`);
  db.close();
  return { filename, job };
}

test("legacy export preserves raw projections, complete receipts and proposal events without credential tables", async t => {
  const { filename, job } = await fixture(t), before = await readFile(filename);
  const snapshot = readLegacyScheduler(filename);
  assert.equal(snapshot.jobs.length, 1);
  assert.equal(snapshot.jobs[0].value.state.lastRunAtMs, 100);
  assert.equal(snapshot.receipts[0].value.receipt_id, "receipt-1");
  assert.equal(snapshot.scratch[0].value.revision, 3);
  assert.equal(snapshot.proposals[0].value.record_json, '{"status":"pending"}');
  assert.equal(snapshot.counts.skill_workshop_proposal_events, 1);
  assert.equal(snapshot.sourceTables.find(row => row.value.table === "cron_jobs" && row.value.row)?.value.row.job_json, JSON.stringify(job));
  assert.ok(!JSON.stringify(snapshot).includes("fixture-private-value"));
  assert.deepEqual(await readFile(filename), before);
});

test("legacy schema drift and ambiguous job identities stop export", async t => {
  const { filename, job } = await fixture(t);
  const db = new DatabaseSync(filename);
  db.prepare("INSERT INTO cron_jobs VALUES (?,?,?,?,?)").run("other-store", job.id, JSON.stringify(job), "{}", 1);
  db.close();
  assert.throws(() => readLegacyScheduler(filename), /duplicate job IDs/);
});

test("legacy enabled-state disagreement cannot enable or discard an automation", async t => {
  const { filename } = await fixture(t);
  const db = new DatabaseSync(filename);
  db.exec("UPDATE cron_jobs SET enabled=0"); db.close();
  assert.throws(() => readLegacyScheduler(filename), /projection/);
});
