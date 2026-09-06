import { validateChatSendParams } from "@openclaw/gateway-protocol";
import { describe, expect, it, vi } from "vitest";

import { NeuraGateway, activitiesFromGatewayEvent, normalizeNeuraHistory, workspaceNeuraMediaUrl } from "./openclaw";

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

  it("maps streamed preambles into safe expandable progress", () => {
    const progress = activitiesFromGatewayEvent({ event: "agent", payload: {
      sessionKey: "agent:main:neura:test",
      runId: "run-1",
      stream: "item",
      data: { kind: "preamble", itemId: "commentary-1", phase: "update", progressText: "I’ll inspect the implementation." },
    } });

    expect(progress).toEqual([expect.objectContaining({
      id: "thinking:commentary-1",
      kind: "thinking",
      title: "Progress update",
      detail: "I’ll inspect the implementation.",
    })]);
  });

  it("keeps a redacted code patch available for file-change review", () => {
    const activities = activitiesFromGatewayEvent({ event: "session.tool", payload: {
      sessionKey: "agent:main:neura:test",
      runId: "run-1",
      stream: "tool",
      data: {
        phase: "start",
        name: "apply_patch",
        toolCallId: "patch-1",
        arguments: "*** Begin Patch\n+const ready = true;\n+OPENAI_API_KEY=private-value\n*** End Patch",
      },
    } });

    expect(activities[0]).toMatchObject({
      kind: "file",
      title: "Updating files",
      output: "*** Begin Patch\n+const ready = true;\n+OPENAI_API_KEY=[redacted]\n*** End Patch",
    });
    expect(JSON.stringify(activities)).not.toContain("private-value");
  });

  it("reads phase-aware text signatures and keeps commentary out of the answer", () => {
    const history = normalizeNeuraHistory([
      { role: "user", id: "user-1", content: [{ type: "text", text: "Check it" }] },
      { role: "assistant", id: "assistant-1", content: [
        { type: "text", text: "I’ll inspect the files.", textSignature: JSON.stringify({ v: 1, id: "commentary-1", phase: "commentary" }) },
        { type: "text", text: "The implementation is ready.", textSignature: JSON.stringify({ v: 1, id: "final-1", phase: "final_answer" }) },
      ] },
    ], "agent:main:neura:test");

    expect(history).toHaveLength(2);
    expect(history[1].text).toBe("The implementation is ready.");
    expect(history[1].activities).toEqual([expect.objectContaining({
      title: "Progress update",
      detail: "I’ll inspect the files.",
    })]);
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

  it("keeps an unfinished history tail out of the transcript after refresh", () => {
    const history = normalizeNeuraHistory([
      { role: "user", id: "user-1", content: [{ type: "text", text: "Push to GitHub" }] },
      { role: "assistant", id: "progress-1", content: [{ type: "text", text: "I’ll authenticate through the host integration." }] },
      { role: "assistant", id: "call-1", content: [
        { type: "text", text: "The connector confirms the repository is empty." },
        { type: "toolCall", id: "tool-1", name: "github_get_profile", arguments: {} },
      ] },
      { role: "toolResult", toolCallId: "tool-1", content: [{ type: "text", text: "ok" }] },
    ], "agent:main:neura:test", { hideUnfinishedTail: true });

    expect(history).toHaveLength(2);
    expect(history[1].text).toBe("");
    expect(history[1].activities?.map((activity) => activity.title)).toEqual([
      "Progress update",
      "Github Get Profile",
      "Progress update",
    ]);
    expect(history[1].activities?.map((activity) => activity.detail)).toEqual(expect.arrayContaining([
      "I’ll authenticate through the host integration.",
      "The connector confirms the repository is empty.",
    ]));
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

describe("Native proposed plan metadata", () => {
  it("distinguishes completed native plans from user text and ordinary task progress", () => {
    const signature = JSON.stringify({ v: 1, phase: "final_answer", proposedPlan: true });
    const messages = normalizeNeuraHistory([
      { role: "user", id: "u", content: [{ type: "text", text: "A user plan", textSignature: signature }] },
      { role: "assistant", id: "a", content: [{ type: "text", text: "<proposed_plan>Ordinary text</proposed_plan>" }] },
      { role: "assistant", id: "p", content: [{ type: "text", text: "The native plan", textSignature: signature }] },
    ], "private");
    expect(messages.filter((message) => message.proposedPlan).map((message) => message.id)).toEqual(["p"]);
  });
});

it("removes native media marker lines only when backed by attachment metadata", () => {
  const attachment = { type: "attachment", attachment: { kind: "image", label: "photo.png", mimeType: "image/png", url: "data:image/png;base64,aGVsbG8=" } };
  const result = normalizeNeuraHistory([
    { role: "user", content: [{ type: "text", text: "Keep this caption\n[media attached: media://inbound/photo]" }, attachment], __openclaw: { media: [{ url: "media://inbound/photo" }] } },
    { role: "user", content: [{ type: "text", text: "photo.png" }, attachment] },
    { role: "user", content: [{ type: "text", text: "[media attached: unknown]" }, attachment] },
  ], "chat");
  expect(result[0].text).toBe("Keep this caption");
  expect(result[1].text).toBe("photo.png");
  expect(result[2].text).toBe("[media attached: unknown]");
});


it("sends plans through the published unmodified chat schema", async () => {
  const request = vi.fn().mockResolvedValue({ runId: "r" });
  const gateway = Object.assign(Object.create(NeuraGateway.prototype), { client: { request }, agentId: "main" }) as NeuraGateway;
  await gateway.send({ key: "agent:main:neura:test", sessionId: "s", title: "Test", updatedAt: 0, archived: false, active: false, visibility: "draft" },
    "Please implement the following plan:\n\nInspect the data.", [], "steer", { idempotencyKey: "retry-key" });
  expect(request).toHaveBeenCalledOnce();
  const [method, params] = request.mock.calls[0];
  expect(method).toBe("chat.send");
  expect(validateChatSendParams(params)).toBe(true);
  expect(params).not.toHaveProperty("expectedCollaborationMode");
  expect(params).not.toHaveProperty("implementationPlanMessageId");
  expect(params.idempotencyKey).toBe("retry-key");
});
