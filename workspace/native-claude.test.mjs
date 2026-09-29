import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { claudeArguments, runClaudeTurn } from "./native/claude.mjs";

class FakeClaude extends EventEmitter {
  constructor(onInput) {
    super(); this.sent = []; this.stdout = new PassThrough(); this.stderr = new PassThrough();
    this.stdin = new Writable({ write: (chunk, encoding, callback) => {
      const row = JSON.parse(chunk.toString()); this.sent.push(row);
      if (row.type === "control_request" && row.request.subtype === "initialize") {
        setImmediate(() => this.output({ type: "control_response", response: { request_id: row.request_id, subtype: "success", response: {} } }));
      } else setImmediate(() => onInput(row, this));
      callback();
    } });
  }
  output(row) { this.stdout.write(JSON.stringify(row) + "\n"); }
}
function context(child, overrides = {}) {
  return { cwd: "/workspace", env: {}, model: "fixture-model", input: [{ type: "text", text: "fixture" }],
    revalidate: async () => {}, onSession: async () => {}, onEvent: async () => {},
    executeVersion: async () => ({ stdout: "2.1.226 (Claude Code)\n" }), spawnProcess: () => child, ...overrides };
}
const permission = { type: "control_request", request_id: "permission-1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "pwd" } } };

test("Claude initializes, persists session and streams a native reply", async () => {
  let persisted; const events = [];
  const child = new FakeClaude((row, child) => {
    if (row.type !== "user") return;
    assert.equal(row.session_id, persisted);
    child.output({ type: "stream_event", session_id: persisted, event: { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } } });
    child.output({ type: "result", session_id: persisted, is_error: false, result: "hello" });
  });
  const result = await runClaudeTurn(context(child, { onSession: async id => { persisted = id; }, onEvent: async (kind, data) => events.push({ kind, data }) }));
  assert.equal(result.status, "succeeded");
  assert.equal(result.nativeSession, persisted);
  assert.equal(events[0].data.text, "hello");
});
test("Claude preserves rapid text deltas without waiting for a lease round trip per fragment", async () => {
  const output = [], fragments = Array.from({ length: 30 }, (_, index) => `part-${index} `);
  let checks = 0;
  const child = new FakeClaude((row, child) => {
    if (row.type !== "user") return;
    for (const text of fragments) child.output({ type: "stream_event", session_id: row.session_id,
      event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
    child.output({ type: "result", session_id: row.session_id, is_error: false });
  });
  const result = await runClaudeTurn(context(child, {
    revalidate: async () => { checks++; await new Promise(resolve => setTimeout(resolve, 5)); },
    onEvent: async (kind, data) => { if (kind === "output") output.push(data.text); },
  }));
  assert.equal(result.status, "succeeded");
  assert.deepEqual(output, fragments);
  assert.ok(checks < fragments.length / 2, `expected bounded lease checks, got ${checks}`);
});

test("Claude native permission decisions return only the approved original tool input", async () => {
  const child = new FakeClaude((row, child) => {
    if (row.type === "user") child.output(permission);
    if (row.type === "control_response") child.output({ type: "result", is_error: false });
  });
  const result = await runClaudeTurn(context(child, { approve: async () => ({ decision: "accept", updatedInput: { command: "unrequested command" } }) }));
  assert.equal(result.status, "succeeded");
  assert.deepEqual(child.sent.find(row => row.type === "control_response").response.response,
    { behavior: "allow", updatedInput: { command: "pwd" } });
});

test("Claude background approval requirements block without a native allow response", async () => {
  const child = new FakeClaude((row, child) => { if (row.type === "user") child.output(permission); });
  const result = await runClaudeTurn(context(child, { background: true }));
  assert.equal(result.status, "blocked");
  assert.ok(!child.sent.some(row => row.type === "control_response"));
});

test("Claude mismatched sessions fail closed and unanswered approvals can be cancelled", async () => {
  const mismatch = new FakeClaude((row, child) => { if (row.type === "user") child.output({ type: "result", session_id: "other-session" }); });
  assert.equal((await runClaudeTurn(context(mismatch))).status, "unknown");
  const abort = new AbortController();
  const child = new FakeClaude((row, child) => {
    if (row.type === "user") { child.output(permission); setImmediate(() => abort.abort()); }
  });
  assert.equal((await runClaudeTurn(context(child, { signal: abort.signal, approve: () => new Promise(() => {}) }))).status, "cancelled");
});

test("Claude resumes exact native session without fallback model or permission bypass flags", () => {
  const session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const args = claudeArguments({ model: "fixture", nativeSession: session, policy: { sandbox: "read-only", approval: "on-request" } });
  assert.equal(args[args.indexOf("--resume") + 1], session);
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Glob,Grep");
  assert.ok(!args.includes("--fallback-model"));
  assert.ok(!args.includes("--dangerously-skip-permissions"));
  assert.ok(args.includes("--strict-mcp-config"));
});

test("Claude cancellation during version verification cannot execute the prompt", async () => {
  const abort = new AbortController();
  const result = await runClaudeTurn(context(null, { signal: abort.signal,
    executeVersion: async () => { abort.abort(); return { stdout: "2.1.226 (Claude Code)" }; },
    spawnProcess: () => assert.fail("cancelled turn must not spawn") }));
  assert.equal(result.status, "cancelled");
});
