import assert from "node:assert/strict";
import test from "node:test";
import { agentEnvironment, retireWorkspaceApiKey } from "./provider-environment.mjs";

test("keeps audio credentials out of ambient text-agent authentication", () => {
  const environment = { OPENAI_API_KEY: "secret-example", PATH: "/bin" };
  assert.deepEqual(agentEnvironment(environment), { PATH: "/bin" });
  assert.equal(environment.OPENAI_API_KEY, "secret-example");
});
test("retires legacy text credentials without passing the audio key to any command", () => {
  const calls = [];
  const environment = { OPENAI_API_KEY: "secret-example", PATH: "/bin" };
  assert.equal(retireWorkspaceApiKey(environment, (...args) => {
    calls.push(args);
    return { status: 0, stdout: JSON.stringify({ profiles: [{ id: "openai:neural-labs-workspace-api", type: "api_key" }, { id: "openai:account", type: "oauth" }] }) };
  }), true);
  assert.deepEqual(calls[1][1], ["models", "auth", "logout", "--agent", "main", "--yes", "openai:neural-labs-workspace-api"]);
  assert.equal(JSON.stringify(calls).includes("secret-example"), false);
  assert.equal(environment.OPENAI_API_KEY, "secret-example");
});
test("retirement is idempotent and runs even without an ambient API key", () => {
  let calls = 0;
  assert.equal(retireWorkspaceApiKey({}, () => { calls++; return { status: 0, stdout: '{"profiles":[]}' }; }), false);
  assert.equal(calls, 1);
});
test("credential inspection and removal fail closed without logging command output", () => {
  for (const stdout of ["invalid", "{}"]) {
    assert.throws(() => retireWorkspaceApiKey({}, () => ({ status: 0, stdout })), /Could not inspect/);
  }
  assert.throws(() => retireWorkspaceApiKey({}, () => ({ status: 1, stderr: "secret-example" })), /Could not inspect/);
  let calls = 0;
  assert.throws(() => retireWorkspaceApiKey({}, () => ++calls === 1
    ? { status: 0, stdout: '{"profiles":[{"id":"openai:neural-labs-workspace-api"}]}' }
    : { status: 1, stderr: "secret-example" }), /Could not retire/);
});
