import { describe, expect, it } from "vitest";

import { activitiesFromGatewayEvent, normalizeNeuraHistory } from "./openclaw";

describe("Neura Gateway projections", () => {
  it("reconstructs safe command and thinking steps from durable history", () => {
    const history = normalizeNeuraHistory([
      { role: "user", id: "user-1", content: [{ type: "text", text: "Run the checks" }] },
      { role: "assistant", id: "call-1", content: [
        { type: "reasoning", text: "private internal reasoning" },
        { type: "toolCall", id: "tool-1", name: "exec_command", arguments: { cmd: "PASSWORD=hunter2 npm test" } },
      ] },
      { role: "toolResult", toolCallId: "tool-1", content: [{ type: "text", text: "token=secret-value\n107 tests passed" }] },
      { role: "assistant", id: "assistant-1", content: [{ type: "text", text: "The checks pass." }] },
    ], "agent:main:neura:test");

    expect(history).toHaveLength(2);
    expect(history[1].text).toBe("The checks pass.");
    expect(history[1].activities?.map((activity) => activity.kind)).toEqual(["thinking", "command"]);
    expect(history[1].activities?.[1]).toMatchObject({
      title: "Command completed",
      command: "PASSWORD=[redacted] npm test",
      output: "token=[redacted]\n107 tests passed",
      state: "done",
    });
    expect(JSON.stringify(history)).not.toContain("private internal reasoning");
    expect(JSON.stringify(history)).not.toContain("hunter2");
    expect(JSON.stringify(history)).not.toContain("secret-value");
  });

  it("maps plan frames without exposing a raw thinking stream", () => {
    const plan = activitiesFromGatewayEvent({ event: "session.tool", payload: {
      sessionKey: "agent:main:neura:test",
      runId: "run-1",
      stream: "plan",
      data: { steps: [{ step: "Inspect the UI", status: "completed" }, { step: "Fix scrolling", status: "in_progress" }] },
    } });
    const thinking = activitiesFromGatewayEvent({ event: "session.tool", payload: {
      sessionKey: "agent:main:neura:test",
      runId: "run-1",
      stream: "thinking",
      data: { text: "raw private chain of thought" },
    } });

    expect(plan[0]).toMatchObject({ kind: "plan", title: "Plan updated" });
    expect(plan[0].detail).toContain("completed: Inspect the UI");
    expect(thinking[0]).toMatchObject({ kind: "thinking", detail: "Reasoning through the request" });
    expect(JSON.stringify(thinking)).not.toContain("raw private chain of thought");
  });
});
