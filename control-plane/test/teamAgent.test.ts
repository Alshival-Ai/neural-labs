import { describe, expect, it, vi } from "vitest";

import type { CollaborationStore, TeamAgentRun } from "../src/collaboration.js";
import type { ControlPlaneConfig } from "../src/config.js";
import { TeamAgentProcessor } from "../src/teamAgent.js";

describe("Team Chat personal Neura runner", () => {
  it("runs with the message author's account and persists public work details", async () => {
    const run: TeamAgentRun & { capability: string } = {
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
        trigger: { id: run.triggerMessageId },
        messages: [{
          id: run.triggerMessageId, sequence: 1, channelId: run.channelId, authorKind: "user", author: { id: run.requestedBy!, handle: "maya", displayName: "Maya", role: "user" },
          body: "$Neura summarize this", attachments: [], mentions: [], activities: [], createdAt: "2026-09-03T00:00:00.000Z",
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
    const processor = new TeamAgentProcessor(store, config, vi.fn(), fetchFn, 1);

    processor.enqueue(run);
    await vi.waitFor(() => expect(finishRun).toHaveBeenCalled());

    expect(requestBody).toMatchObject({ userId: run.requestedBy, runId: run.id, capability: run.capability });
    expect(String(requestBody?.prompt)).toContain("@maya: $Neura summarize this");
    expect(saveRunActivities).toHaveBeenCalledWith(run.id, [{ kind: "plan", title: "Plan updated", state: "done" }]);
  });
});
