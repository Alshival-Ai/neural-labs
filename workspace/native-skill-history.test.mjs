import test from "node:test";
import assert from "node:assert/strict";
import { NativeState, canonical, digest } from "./native/state.mjs";
import { NativeSkillHistory } from "./native/skill-history.mjs";

function fixture(t) {
  const state = new NativeState(":memory:"); t.after(() => state.close());
  const migration = "a".repeat(64), incomplete = "b".repeat(64);
  for (const [id, phase] of [[migration, "verified"], [incomplete, "copying"]])
    state.db.prepare("INSERT INTO migrations VALUES (?,?,?,?,?)").run(id, "fixture", "{}", phase, "{}");
  const insert = (category, key, raw, id = migration) => state.db.prepare("INSERT INTO retained_records VALUES (?,?,?,?,?,?)")
    .run(id, category, key, canonical(raw), digest(canonical(raw)), "retained-native-history");
  for (let i = 0; i < 20; i++) insert("proposals", `proposal-${i.toString().padStart(2, "0")}`, { record_json: JSON.stringify({ title: `Proposal ${i}`, status: i % 2 ? "pending" : "applied" }) });
  insert("proposals", "incomplete", { title: "Unverified" }, incomplete);
  insert("sourceTables", "event-1", { table: "skill_workshop_proposal_events", row: { proposal_id: "proposal-00", payload_json: '{"event":"created"}' } });
  insert("sourceTables", "rollback-1", { table: "skill_workshop_proposal_rollbacks", row: { proposal_id: "proposal-00", revision: "original" } });
  insert("sourceTables", "other-1", { table: "skill_workshop_proposal_events", row: { proposal_id: "proposal-01" } });
  insert("sourceTables", "schema", { table: "skill_workshop_proposal_events", schema: "fixture schema" });
  return { state, migration, insert, history: new NativeSkillHistory(state) };
}
const admin = { role: "admin" };
test("retained proposal history paginates every verified record and preserves exact events and rollbacks", t => {
  const { history, state, migration } = fixture(t);
  const before = state.db.prepare("SELECT payload FROM retained_records ORDER BY category,source_key").all();
  let after = "", records = [];
  do { const page = history.list(admin, { after, limit: 7 }); records.push(...page.records); after = page.next; } while (after);
  assert.equal(records.length, 20); assert.equal(new Set(records.map(row => row.id)).size, 20);
  const detail = history.inspect(admin, { migration, id: "proposal-00" });
  assert.equal(detail.record.status, "applied"); assert.equal(detail.readOnly, true);
  assert.equal(detail.history.length, 2);
  assert.equal(detail.history[0].record.payload_json, '{"event":"created"}');
  assert.equal(detail.sha256, digest(canonical(detail.raw)));
  assert.deepEqual(state.db.prepare("SELECT payload FROM retained_records ORDER BY category,source_key").all(), before);
});
test("history fails closed for nonadministrators, bad cursors, missing identities and altered retained evidence", t => {
  const { history, state, migration } = fixture(t);
  assert.throws(() => history.list({ role: "user" }), e => e.status === 403);
  assert.throws(() => history.inspect({ role: "user" }, { migration, id: "proposal-00" }), e => e.status === 403);
  assert.throws(() => history.list(admin, { after: "invalid" }), e => e.status === 400);
  assert.throws(() => history.list(admin, { limit: 1000 }), e => e.status === 400);
  assert.throws(() => history.inspect(admin, { migration: "b".repeat(64), id: "incomplete" }), e => e.status === 404);
  state.db.prepare("UPDATE retained_records SET payload='{}' WHERE source_key='proposal-00'").run();
  assert.throws(() => history.inspect(admin, { migration, id: "proposal-00" }), e => e.status === 409);
});
test("malformed historical JSON remains available verbatim for review", t => {
  const { history, insert, migration } = fixture(t);
  insert("proposals", "malformed", { record_json: "partial original JSON" });
  const record = history.inspect(admin, { migration, id: "malformed" });
  assert.equal(record.raw.record_json, "partial original JSON"); assert.equal(record.record, null);
});
