import { describe, expect, it } from "vitest";

import {
  PRIVATE_NEURA_SESSION,
  shouldIncludeNeuraSession,
  shouldProtectLegacyPrivateSession,
} from "./sessionVisibility";
import type { SessionRow } from "./types";

describe("Neura session visibility", () => {
  const legacy: SessionRow = {
    key: "agent:main:dashboard:legacy",
    title: "Legacy chat",
    updatedAt: 1,
    archived: false,
    active: false,
    visibility: "shared",
    sharingRole: "owner",
  };

  it("defines new chats as creator-only OpenClaw drafts", () => {
    expect(PRIVATE_NEURA_SESSION).toEqual({ category: "neura-private", visibility: "draft" });
  });

  it("protects only creator-owned legacy chats and never future team channels", () => {
    expect(shouldProtectLegacyPrivateSession(legacy)).toBe(true);
    expect(shouldProtectLegacyPrivateSession({ ...legacy, sharingRole: "member" })).toBe(false);
    expect(shouldProtectLegacyPrivateSession({ ...legacy, category: "neura-team" })).toBe(false);
    expect(shouldProtectLegacyPrivateSession({ ...legacy, visibility: "draft" })).toBe(false);
  });

  it("keeps dashboard conversations parented to the main session", () => {
    expect(shouldIncludeNeuraSession({
      key: "agent:main:dashboard:thread-1",
      agentId: "main",
      parentSessionKey: "agent:main:main",
      kind: "direct",
    }, "main")).toBe(true);
  });

  it("excludes spawned worker sessions and automation categories", () => {
    expect(shouldIncludeNeuraSession({
      key: "agent:main:worker:thread-1",
      agentId: "main",
      parentSessionKey: "agent:main:main",
    }, "main")).toBe(false);
    expect(shouldIncludeNeuraSession({
      key: "agent:main:cron:thread-1",
      agentId: "main",
      category: "cron",
    }, "main")).toBe(false);
  });
});
