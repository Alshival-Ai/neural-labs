import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { snapshotNativePreservation } from "../src/nativePreservation.js";

describe("native preservation snapshot", () => {
  it("reads notifications and account ownership in one read-only transaction without credentials", async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => ({ rows: sql === "SELECT * FROM notification_deliveries"
      ? [{ event_id: "event", user_id: "user", channel: "email", status: "unknown", updated_at: new Date("2026-01-01T00:00:00Z") }]
      : sql.includes("FROM users") ? [{ id: "user", role: "admin", status: "active" }]
        : sql.includes("FROM model_provider_policies") ? [{ policy_key: "workspace:background", user_id: null, policy: { model: "fixture" } }] : [] }));
    const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
    const result = await snapshotNativePreservation(pool);
    expect(query.mock.calls[0]?.[0]).toBe("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(result.notification_deliveries?.[0]?.value.updated_at).toBe("2026-01-01T00:00:00.000Z");
    expect(result.notification_deliveries?.[0]?.value.status).toBe("unknown");
    expect(result.ownership).toHaveLength(2);
    expect(query.mock.calls.some(([sql]) => /password|secret|identities|plugin_connections|DELETE|UPDATE|INSERT/.test(sql))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases the snapshot if any collection cannot be read", async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql === "SELECT * FROM notification_events") throw new Error("snapshot unavailable");
      return { rows: [] };
    });
    const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
    await expect(snapshotNativePreservation(pool)).rejects.toThrow("snapshot unavailable");
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});
