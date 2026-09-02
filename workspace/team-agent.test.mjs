import assert from "node:assert/strict";
import test from "node:test";

import { runTeamAgent } from "./team-agent.mjs";

test("runs an isolated OpenClaw agent with a channel-scoped MCP capability", async () => {
  let invocation;
  const reply = await runTeamAgent({
    prompt: "Summarize the release discussion.",
    capability: "channel-capability-at-least-thirty-two-characters",
    workspaceRoot: "/workspace",
    execute: async (...args) => {
      invocation = args;
      return { stdout: JSON.stringify({ final: "The release is ready." }), stderr: "" };
    },
  });

  assert.equal(reply, "The release is ready.");
  assert.deepEqual(invocation.slice(0, 2), [
    "openclaw",
    ["agent", "exec", "Summarize the release discussion.", "--cwd", "/workspace", "--json"],
  ]);
  assert.equal(invocation[2].env.NEURAL_LABS_TEAM_CAPABILITY, "channel-capability-at-least-thirty-two-characters");
});

test("accepts payload output and rejects an empty OpenClaw response", async () => {
  const fromPayloads = await runTeamAgent({
    prompt: "Hello",
    capability: "channel-capability-at-least-thirty-two-characters",
    workspaceRoot: "/workspace",
    execute: async () => ({ stdout: JSON.stringify({ payloads: [{ text: "First" }, { text: "Second" }] }), stderr: "" }),
  });
  assert.equal(fromPayloads, "First\n\nSecond");

  await assert.rejects(() => runTeamAgent({
    prompt: "Hello",
    capability: "channel-capability-at-least-thirty-two-characters",
    workspaceRoot: "/workspace",
    execute: async () => ({ stdout: JSON.stringify({ payloads: [] }), stderr: "" }),
  }), /no final assistant message/);
});
