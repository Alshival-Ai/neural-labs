import { describe, expect, it, vi } from "vitest";
import { authorizeNativeTeam } from "../src/nativeTeam.js";
import type { Database } from "../src/database.js";
import type { ControlPlaneConfig } from "../src/config.js";

const input = { run: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", channel: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  actor: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", capability: "team-capability-at-least-thirty-two-characters" };

function fixture(override: Record<string, unknown> = {}) {
  const row = { status: "active", role: "user", enabled: true, scope: "team", generation: 3,
    connection_generation: 3, connection_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", provider: "codex",
    method: "subscription", model: "fixture-model", revision: "2", audience: "everyone",
    owner_user_id: null, ...override };
  const query = vi.fn(async (sql: string, _args?: unknown[]) => {
    if (sql.includes("FROM team_agent_runs r")) return { rows: [row], rowCount: 1 };
    if (sql.includes("FROM team_channel_members")) return { rows: [{ id: 1 }], rowCount: 1 };
    if (sql.includes("FROM managed_identities")) return { rows: [{ subject: "123" }], rowCount: 1 };
    throw new Error(`Unexpected query ${sql}`);
  });
  return { database: { pool: { query } } as unknown as Database, query };
}

describe("native Team Chat authority", () => {
  it("binds a running channel capability to its saved Team credential and generation", async () => {
    const f = fixture();
    const result = await authorizeNativeTeam(f.database, {} as ControlPlaneConfig, input);
    expect(result).toMatchObject({ actor: input.actor, scope: "team", model: "fixture-model",
      binding: { owner: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", generation: 3 },
      team: { run: input.run, channel: input.channel, capability: input.capability } });
    expect(f.query.mock.calls[0]?.[1]).toEqual([input.run, input.channel, input.actor, expect.any(String)]);
  });

  it.each([{ scope: "personal" }, { enabled: false }, { generation: 4 }, { status: "suspended" }])
  ("rejects an unavailable Team binding: %j", async override => {
    const f = fixture(override);
    await expect(authorizeNativeTeam(f.database, {} as ControlPlaneConfig, input)).rejects.toThrow(/unavailable/);
  });

  it("checks live managed portal membership on each authorization", async () => {
    const f = fixture();
    const config = { managed: { portalOrigin: "https://portal.example", workspace: input.channel, instance: input.run } } as ControlPlaneConfig;
    const denied = vi.fn(async () => ({ members: [], generation: 5 }));
    await expect(authorizeNativeTeam(f.database, config, input, denied)).rejects.toThrow(/revoked/);
    expect(denied).toHaveBeenCalledWith(config, "members", { subjects: ["123"] });
    const allowed = await authorizeNativeTeam(f.database, config, input,
      async () => ({ members: [{ subject: "123", role: "user" }], generation: 5 }));
    expect(allowed.authorityGeneration).toBe(5);
  });
});
