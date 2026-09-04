import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { activitiesFromExecSummary, activitiesFromHistory, personalAgentExecConfig, runTeamAgent } from "./team-agent.mjs";

const input = {
  prompt: "Summarize the release discussion.",
  capability: "channel-capability-at-least-thirty-two-characters",
  agentId: "nl-11111111111141118111111111111111",
  runId: "11111111-1111-4111-8111-111111111111",
  workspaceRoot: "/workspace",
  loadConfig: async () => ({
    agents: {
      defaults: { systemAgent: { agentId: "main" } },
      entries: { ["nl-11111111111141118111111111111111"]: { workspace: "/workspace" } },
    },
  }),
};

test("runs the message author's personal agent with a channel-scoped capability", async () => {
  let invocation;
  const result = await runTeamAgent({
    ...input,
    execute: async (...args) => {
      invocation = args;
      const messagePath = args[1][args[1].indexOf("--message-file") + 1];
      assert.equal(await readFile(messagePath, "utf8"), input.prompt);
      const configPath = args[1][args[1].indexOf("--config") + 1];
      const config = JSON.parse(await readFile(configPath, "utf8"));
      assert.equal(config.agents.defaults.systemAgent.agentId, input.agentId);
      return { stdout: JSON.stringify({ result: { payloads: [{ text: "The release is ready." }] } }), stderr: "" };
    },
  });

  assert.deepEqual(result, { reply: "The release is ready.", activities: [] });
  assert.equal(invocation[0], "openclaw");
  assert.deepEqual(invocation[1].slice(0, 5), ["agent", "exec", "--config", invocation[1][3], "--message-file"]);
  assert.equal(invocation[1].includes(input.prompt), false);
  assert.deepEqual(invocation[1].slice(6), ["--cwd", input.workspaceRoot, "--json", "--timeout", "600"]);
  assert.equal(invocation[2].cwd, "/workspace");
  assert.equal(invocation[2].env.NEURAL_LABS_TEAM_CAPABILITY, input.capability);
});

test("returns bounded work activity from the isolated execution envelope", async () => {
  const result = await runTeamAgent({
    ...input,
    execute: async () => ({ stdout: JSON.stringify({
      ok: true,
      final: "Done.",
      toolSummary: { calls: 3, tools: ["exec_command", "apply_patch"], failures: 0 },
    }), stderr: "" }),
  });

  assert.equal(result.reply, "Done.");
  assert.deepEqual(result.activities, [{
    kind: "operation",
    title: "Shared work completed",
    detail: "3 tool calls. Tools: exec_command, apply_patch.",
    state: "done",
  }]);
});

test("rejects missing personal ownership and empty output", async () => {
  await assert.rejects(() => runTeamAgent({ ...input, agentId: "main", execute: async () => ({ stdout: "{}" }) }), /personal agent/);
  await assert.rejects(() => runTeamAgent({ ...input, execute: async () => ({ stdout: JSON.stringify({ payloads: [] }) }) }), /no final assistant message/);
});

test("ignores unstructured history instead of exposing it", () => {
  assert.deepEqual(activitiesFromHistory([{ role: "assistant", content: "ordinary final text" }]), []);
});

test("selects the personal agent in an isolated execution config", () => {
  const config = personalAgentExecConfig({
    agents: {
      defaults: { systemAgent: { agentId: "main" }, heartbeat: { agentId: "main" } },
      entries: { [input.agentId]: { agentDir: "/personal-agent" } },
    },
  }, input.agentId);

  assert.equal(config.agents.defaults.systemAgent.agentId, input.agentId);
  assert.equal(config.agents.defaults.heartbeat.agentId, "main");
  assert.equal(config.agents.entries[input.agentId].agentDir, "/personal-agent");
  assert.throws(() => personalAgentExecConfig({ agents: { entries: {} } }, input.agentId), /not provisioned/);
});

test("rejects failed isolated execution envelopes", async () => {
  await assert.rejects(() => runTeamAgent({
    ...input,
    execute: async () => ({ stdout: JSON.stringify({ ok: false, error: { message: "Provider unavailable" } }) }),
  }), /Provider unavailable/);
  assert.deepEqual(activitiesFromExecSummary({ calls: 0, tools: ["exec_command"] }), []);
});
