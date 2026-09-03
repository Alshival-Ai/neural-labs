import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { activitiesFromHistory, runTeamAgent } from "./team-agent.mjs";

const input = {
  prompt: "Summarize the release discussion.",
  capability: "channel-capability-at-least-thirty-two-characters",
  agentId: "nl-11111111111141118111111111111111",
  runId: "11111111-1111-4111-8111-111111111111",
  workspaceRoot: "/workspace",
};

test("runs the message author's personal agent with a channel-scoped capability", async () => {
  let invocation;
  const result = await runTeamAgent({
    ...input,
    execute: async (...args) => {
      invocation = args;
      const messagePath = args[1][args[1].indexOf("--message-file") + 1];
      assert.equal(await readFile(messagePath, "utf8"), input.prompt);
      return { stdout: JSON.stringify({ result: { payloads: [{ text: "The release is ready." }] } }), stderr: "" };
    },
  });

  assert.deepEqual(result, { reply: "The release is ready.", activities: [] });
  assert.equal(invocation[0], "openclaw");
  assert.deepEqual(invocation[1].slice(0, 5), ["agent", "--local", "--agent", input.agentId, "--message-file"]);
  assert.equal(invocation[1].includes(input.prompt), false);
  assert.deepEqual(invocation[1].slice(6), ["--session-key", `agent:${input.agentId}:team-${input.runId}`, "--json", "--timeout", "600"]);
  assert.equal(invocation[2].cwd, "/workspace");
  assert.equal(invocation[2].env.NEURAL_LABS_TEAM_CAPABILITY, input.capability);
});

test("returns redacted command and plan activity from the personal run history", async () => {
  const result = await runTeamAgent({
    ...input,
    execute: async () => ({ stdout: JSON.stringify({ final: "Done." }), stderr: "" }),
    gatewayRequest: async (method, params) => {
      assert.equal(method, "chat.history");
      assert.equal(params.agentId, input.agentId);
      return { messages: [
        { role: "assistant", content: [
          { type: "reasoning", text: "private chain of thought" },
          { type: "tool_call", id: "call-1", name: "exec_command", arguments: { cmd: "deploy --token=secret-value" } },
        ] },
        { role: "tool", id: "tool-result", toolCallId: "call-1", content: "authorization: very-secret\ncomplete" },
      ] };
    },
  });

  assert.equal(result.reply, "Done.");
  assert.equal(result.activities[0].kind, "thinking");
  assert.equal(result.activities[0].detail.includes("chain of thought"), false);
  assert.equal(result.activities[1].kind, "command");
  assert.match(result.activities[1].command, /token=\[redacted\]/u);
  assert.match(result.activities[1].output, /authorization: \[redacted\]/u);
});

test("rejects missing personal ownership and empty output", async () => {
  await assert.rejects(() => runTeamAgent({ ...input, agentId: "main", execute: async () => ({ stdout: "{}" }) }), /personal agent/);
  await assert.rejects(() => runTeamAgent({ ...input, execute: async () => ({ stdout: JSON.stringify({ payloads: [] }) }) }), /no final assistant message/);
});

test("ignores unstructured history instead of exposing it", () => {
  assert.deepEqual(activitiesFromHistory([{ role: "assistant", content: "ordinary final text" }]), []);
});
