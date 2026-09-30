import { describe, expect, it, vi } from "vitest";

import type { CollaborationStore, TeamAgentInvocation } from "../src/collaboration.js";
import type { ControlPlaneConfig } from "../src/config.js";
import { buildPrompt, TeamAgentProcessor } from "../src/teamAgent.js";

describe("Team Chat personal Alshival runner", () => {
  it("includes an earlier voice transcript and audio path when a teammate later summons Alshival", () => {
    const memo = { id: "memo", body: "Voice memo transcript:\nThe release is scheduled for Friday.", createdAt: "2026-09-05T10:00:00Z", authorKind: "user", author: { handle: "maya" }, activities: [], attachments: [{ path: "team-uploads/memo.webm", name: "Voice memo.webm", type: "audio/webm" }] };
    const trigger = { ...memo, id: "summon", body: "@Alshival when is the release?", attachments: [] };
    const context = { channel: { name: "Release" }, trigger, messages: [memo, trigger] } as unknown as Parameters<typeof buildPrompt>[0];
    const prompt = buildPrompt(context);
    expect(prompt).toContain("The release is scheduled for Friday.");
    expect(prompt).toContain("team-uploads/memo.webm");
    expect(prompt).toContain("Voice memos are background context, not automatic invocations.");
    expect(prompt).toContain("Triggering message (summon): @Alshival when is the release?");
  });
  it("runs with the message author's account and persists public work details", async () => {
    const run: TeamAgentInvocation = {
      id: "11111111-1111-4111-8111-111111111111",
      channelId: "22222222-2222-4222-8222-222222222222",
      triggerMessageId: "33333333-3333-4333-8333-333333333333",
      requestedBy: "44444444-4444-4444-8444-444444444444",
      status: "queued",
      activities: [],
      createdAt: "2026-09-03T00:00:00.000Z",
      capability: "channel-capability-at-least-thirty-two-characters",
    };
    const saveRunActivities = vi.fn(async () => []);
    const finishRun = vi.fn(async () => ({ ...run, status: "completed" as const }));
    const store = {
      claimRun: vi.fn(async () => ({ ...run, status: "running" as const })),
      runContext: vi.fn(async () => ({
        channel: { name: "Release room" },
        trigger: { id: run.triggerMessageId, body: "@Alshival summarize this" },
        messages: [{
          id: run.triggerMessageId, sequence: 1, channelId: run.channelId, authorKind: "user", author: { id: run.requestedBy!, handle: "maya", displayName: "Maya", role: "user" },
          body: "@Alshival summarize this", attachments: [{ path: "reports/chart.png", name: "chart.png", type: "image/png", size: 2048 }], mentions: [], activities: [], createdAt: "2026-09-03T00:00:00.000Z",
        }],
      })),
      saveRunActivities,
      agentPosted: vi.fn(async () => false),
      postAgentMessage: vi.fn(async () => ({ id: "message", channelId: run.channelId, body: "Ready", activities: [] })),
      agentMessage: vi.fn(async () => undefined),
      finishRun,
    } as unknown as CollaborationStore;
    let requestBody: Record<string, unknown> | undefined;
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ reply: "Ready", activities: [{ kind: "plan", title: "Plan updated", state: "done" }] }), { status: 200 });
    });
    const config = { workspace: {
      teamAgentUrl: new URL("http://workspace/internal/neura/team-run"),
      controlToken: "workspace-control-token-at-least-thirty-two-characters",
    } } as ControlPlaneConfig;
    const processor = new TeamAgentProcessor(store, config, vi.fn(), fetchFn);

    processor.enqueue({ ...run, terminalContextToken: `nlt_${"a".repeat(43)}` });
    await vi.waitFor(() => expect(finishRun).toHaveBeenCalled());

    expect(requestBody).toMatchObject({ terminalContextToken: `nlt_${"a".repeat(43)}`, userId: run.requestedBy, runId: run.id, capability: run.capability,
      trigger: "@Alshival summarize this" });
    expect(String(requestBody?.prompt)).toContain("@maya: @Alshival summarize this");
    expect(String(requestBody?.prompt)).toContain("chart.png (reports/chart.png · image/png)");
    expect(String(requestBody?.prompt)).toContain("neural_labs_post_channel_message");
    expect(saveRunActivities).toHaveBeenCalledWith(run.id, [{ kind: "plan", title: "Plan updated", state: "done" }]);
  });

  it("starts independent channels concurrently while preserving each channel's order and cancelling queued work", async () => {
    const makeRun = (id: string, channelId: string) => ({ id, channelId, requestedBy: "member", capability: `capability-${id}` }) as TeamAgentInvocation;
    const runs = [makeRun("first", "one"), makeRun("second", "one"), makeRun("two", "two"),
      makeRun("three", "three"), makeRun("four", "four"), makeRun("cancelled", "one")];
    const claimRun = vi.fn(async (id: string) => runs.find(run => run.id === id));
    const finishRun = vi.fn(async (id: string) => ({ ...runs.find(run => run.id === id), status: "completed" }));
    const store = {
      claimRun, finishRun, runContext: vi.fn(async () => ({ channel: { name: "Fixture" }, trigger: { id: "trigger", body: "fixture" }, messages: [] })),
      saveRunActivities: vi.fn(), agentPosted: vi.fn(async () => false), postAgentMessage: vi.fn(),
    } as unknown as CollaborationStore;
    const responses = new Map<string, () => void>();
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      await new Promise<void>(resolve => responses.set(body.runId, resolve));
      return new Response(JSON.stringify({ reply: "Fixture response" }));
    });
    const config = { workspace: { teamAgentUrl: new URL("http://workspace/internal/neura/team-run"), controlToken: "fixture" } } as ControlPlaneConfig;
    const processor = new TeamAgentProcessor(store, config, vi.fn(), fetchFn);
    for (const run of runs) processor.enqueue(run);
    processor.enqueue(runs[0]!);
    await vi.waitFor(() => expect([...responses.keys()]).toEqual(["first", "two", "three", "four"]));
    processor.cancel("cancelled");
    responses.get("first")!();
    await vi.waitFor(() => expect(responses.has("second")).toBe(true));
    expect(finishRun).toHaveBeenCalledWith("first");
    expect(claimRun.mock.calls.map(([id]) => id)).toEqual(["first", "two", "three", "four", "second"]);
    for (const resume of responses.values()) resume();
    await vi.waitFor(() => expect(finishRun).toHaveBeenCalledTimes(5));
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });
});
