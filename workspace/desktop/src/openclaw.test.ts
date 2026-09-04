import { describe, expect, it } from "vitest";

import { activitiesFromGatewayEvent, normalizeNeuraHistory, workspaceNeuraMediaUrl } from "./openclaw";

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

  it("folds durable commentary into the final answer's work details", () => {
    const history = normalizeNeuraHistory([
      { role: "user", id: "user-1", content: [{ type: "text", text: "Where is the demo hosted?" }] },
      { role: "assistant", id: "progress-1", phase: "commentary", content: [{ type: "text", text: "I’ll check the deployment notes." }] },
      { role: "assistant", id: "progress-2", content: [{ type: "text", text: "I found the current host entry." }] },
      { role: "assistant", id: "answer-1", phase: "final_answer", content: [{ type: "text", text: "The demo host is online." }] },
    ], "agent:main:neura:test");

    expect(history).toHaveLength(2);
    expect(history[1].text).toBe("The demo host is online.");
    expect(history[1].activities).toHaveLength(2);
    expect(history[1].activities?.map((activity) => activity.title)).toEqual(["Progress update", "Progress update"]);
    expect(history[1].activities?.map((activity) => activity.detail)).toEqual([
      "I’ll check the deployment notes.",
      "I found the current host entry.",
    ]);
  });

  it("preserves user files and generated images from durable message history", () => {
    const history = normalizeNeuraHistory([
      {
        role: "user",
        id: "user-files",
        content: [{ type: "text", text: "Use these" }],
        attachments: [{ type: "file", fileName: "brief.pdf", mimeType: "application/pdf", sizeBytes: 4096 }],
      },
      {
        role: "assistant",
        id: "assistant-image",
        content: [
          { type: "text", text: "Here is the mockup." },
          { type: "image", name: "mockup.png", media_type: "image/png", data: "aGVsbG8=" },
        ],
      },
    ], "agent:main:neura:test");

    expect(history[0].attachments).toEqual([{ name: "brief.pdf", type: "application/pdf", size: 4096 }]);
    expect(history[1].attachments).toEqual([{ name: "mockup.png", type: "image/png", url: "data:image/png;base64,aGVsbG8=" }]);
  });

  it("keeps internal generated media private until OpenClaw issues a download ticket", () => {
    const sessionKey = "agent:nl-user:dashboard:chat";
    const artifactId = "artifact_managed_image_7ecda889-9f92-4cef-a162-5e6a56ad6abc";
    const canonical = `/api/chat/media/outgoing/${encodeURIComponent(sessionKey)}/7ecda889-9f92-4cef-a162-5e6a56ad6abc/full`;
    const history = normalizeNeuraHistory([{
      role: "assistant",
      id: "generated-image",
      content: [{
        type: "image",
        artifactId,
        url: canonical,
        alt: "restaurant-header.png",
        mimeType: "image/png",
        sizeBytes: 2_894_994,
      }],
    }], sessionKey);

    expect(history[0].attachments).toEqual([{
      name: "restaurant-header.png",
      type: "image/png",
      artifactId,
      size: 2_894_994,
    }]);
    expect(workspaceNeuraMediaUrl(canonical)).toBeUndefined();
    expect(workspaceNeuraMediaUrl(`${canonical}?mediaTicket=v1.cGF5bG9hZA.c2lnbmF0dXJl`)).toBe(
      `/workspace/api/neura/media/outgoing/${encodeURIComponent(sessionKey)}/7ecda889-9f92-4cef-a162-5e6a56ad6abc/full?mediaTicket=v1.cGF5bG9hZA.c2lnbmF0dXJl`,
    );
    expect(workspaceNeuraMediaUrl("https://evil.example/api/chat/media/outgoing/a/b/full?mediaTicket=v1.a.b")).toBeUndefined();
  });

  it("projects OpenClaw's nested generated-file attachment blocks", () => {
    const history = normalizeNeuraHistory([{
      role: "assistant",
      id: "generated-document",
      content: [{
        type: "attachment",
        attachment: {
          artifactId: "artifact_managed_media_7ecda889-9f92-4cef-a162-5e6a56ad6abc",
          kind: "document",
          label: "launch-brief.pdf",
          mimeType: "application/pdf",
          sizeBytes: 4_096,
          url: "/api/chat/media/outgoing/agent%3Anl-user%3Adashboard%3Achat/7ecda889-9f92-4cef-a162-5e6a56ad6abc/full",
        },
      }],
    }], "agent:nl-user:dashboard:chat");

    expect(history[0].attachments).toEqual([{
      name: "launch-brief.pdf",
      type: "application/pdf",
      artifactId: "artifact_managed_media_7ecda889-9f92-4cef-a162-5e6a56ad6abc",
      size: 4_096,
    }]);
  });
});
