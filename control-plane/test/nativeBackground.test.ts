import { describe, it, expect, vi } from "vitest";
import type { Database } from "../src/database.js";
import type { ControlPlaneConfig } from "../src/config.js";
import { authorizeNativeBackground, nativeBackgroundSchema } from "../src/nativeBackground.js";

function fixture() {
  const input = nativeBackgroundSchema.parse({ job: "job-1", actor: "11111111-1111-4111-8111-111111111111",
    connection: "22222222-2222-4222-8222-222222222222", generation: 3, provider: "codex", method: "subscription",
    model: "fixture-model", policy: { sandbox: "read-only", approval: "on-request" } });
  const member = { id: input.actor, role: "user", status: "active" };
  const connection = { id: input.connection, user_id: input.actor, scope: "personal", enabled: true, generation: 3, provider: "codex", method: "subscription" };
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes("FROM users") ? [member]
    : sql.includes("FROM native_connections") ? [connection] : [{ subject: "123" }] }));
  const config = {} as ControlPlaneConfig;
  const database = { pool: { query } } as unknown as Database;
  return { input, member, connection, query, config, database };
}
describe("native saved background execution policy", () => {
  it("requires live membership and the exact saved credential generation without fallback", async () => {
    const f = fixture();
    expect(await authorizeNativeBackground(f.database, f.config, f.input)).toMatchObject({ background: true, model: f.input.model, policy: f.input.policy });
    f.connection.generation++;
    await expect(authorizeNativeBackground(f.database, f.config, f.input)).rejects.toThrow("unavailable");
    f.connection.generation--; f.member.status = "disabled";
    await expect(authorizeNativeBackground(f.database, f.config, f.input)).rejects.toThrow("unavailable");
    f.member.status = "active"; f.connection.user_id = "another-member";
    await expect(authorizeNativeBackground(f.database, f.config, f.input)).rejects.toThrow("unavailable");
    f.connection.scope = "shared";
    await expect(authorizeNativeBackground(f.database, f.config, f.input)).rejects.toThrow("unavailable");
    f.member.role = "admin";
    expect((await authorizeNativeBackground(f.database, f.config, f.input)).scope).toBe("shared");
    expect(f.query.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
  });
  it("checks managed background permission separately and rejects changed workspace identity", async () => {
    const f = fixture();
    f.config.managed = { workspace: "33333333-3333-4333-8333-333333333333", instance: "44444444-4444-4444-8444-444444444444",
      portalOrigin: "https://portal.example", secret: "fixture-only" };
    const response = { authorized: true, workspace: f.config.managed.workspace, instance: f.config.managed.instance, generation: 8 };
    const exchange = vi.fn().mockResolvedValue(response);
    expect((await authorizeNativeBackground(f.database, f.config, f.input, exchange)).authorityGeneration).toBe(8);
    expect(exchange).toHaveBeenCalledWith(f.config, "background-authorize", { subject: "123" });
    exchange.mockResolvedValue({ ...response, instance: f.config.managed.workspace });
    await expect(authorizeNativeBackground(f.database, f.config, f.input, exchange)).rejects.toThrow("binding changed");
    exchange.mockRejectedValue(new Error("Permission revoked"));
    await expect(authorizeNativeBackground(f.database, f.config, f.input, exchange)).rejects.toThrow("Permission revoked");
  });
});
