import { describe, expect, it } from "vitest";

import { buildSessionDeletionPlan } from "./sessionDeletion";
import type { SessionRow } from "./types";

const session: SessionRow = {
  key: "agent:main:dashboard:conversation-1",
  sessionId: "session-1",
  title: "Conversation",
  updatedAt: 1,
  archived: false,
  active: false,
  visibility: "draft",
};

describe("Neura session deletion", () => {
  it("archives an active conversation before using OpenClaw's operator-write deletion path", () => {
    expect(buildSessionDeletionPlan(session)).toEqual({
      archive: {
        key: session.key,
        agentId: "main",
        expectedSessionId: session.sessionId,
        archived: true,
      },
      remove: {
        key: session.key,
        agentId: "main",
        expectedSessionId: session.sessionId,
        deleteTranscript: true,
        archivedOnly: true,
      },
    });
  });

  it("deletes an already archived conversation without another archive request", () => {
    expect(buildSessionDeletionPlan({ ...session, archived: true })).toEqual({
      remove: {
        key: session.key,
        agentId: "main",
        expectedSessionId: session.sessionId,
        deleteTranscript: true,
        archivedOnly: true,
      },
    });
  });
});
