import assert from "node:assert/strict";
import test from "node:test";
import { agentEnvironment, importWorkspaceApiKey } from "./provider-environment.mjs";

test("keeps audio credentials out of ambient text-agent authentication", () => {
  const environment = { OPENAI_API_KEY: "secret-example", PATH: "/bin" };
  assert.deepEqual(agentEnvironment(environment), { PATH: "/bin" });
  assert.equal(environment.OPENAI_API_KEY, "secret-example");
});
test("imports workspace API credentials through stdin, never process arguments or logs", () => {
  const key = "secret-example";
  let call;
  assert.equal(importWorkspaceApiKey({ OPENAI_API_KEY: key }, (...args) => { call = args; return { status: 0 }; }), true);
  assert.equal(JSON.stringify(call[1]).includes(key), false);
  assert.equal(call[2].input, `${key}\n`);
  assert.throws(() => importWorkspaceApiKey({ OPENAI_API_KEY: key }, () => ({ status: 1, stderr: key })), (error) => !error.message.includes(key));
});
