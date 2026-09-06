import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../src/database.js";
import { ModelProviderPolicies } from "../src/modelProviders.js";
import type { ControlPlaneConfig } from "../src/config.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("PostgreSQL model policies", () => {
  const schema = `models_test_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool, pool: Pool, database: Database;
  const workspace = { controlUrl: new URL("http://workspace/internal/provider-auth/openai"), controlToken: "test-only-token" } as ControlPlaneConfig["workspace"];
  const policy = { provider: "openai" as const, mode: "pinned" as const, model: "openai/test-model", effort: "high" };
  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    database = new Database(pool); await database.migrate();
  });
  afterAll(async () => {
    await database?.close();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
  });
  async function owner() { return (await database.createLocalUser({ email: `${randomUUID()}@example.org`, displayName: "Model test", passwordHash: "test-only" })).id; }
  const success: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ agentId: "nl-test", model: body.policy?.model ?? policy.model, effort: "high", revision: body.revision ?? 0 }));
  };
  it("persists owner-scoped defaults and rejects a stale edit", async () => {
    const store = new ModelProviderPolicies(pool, workspace, success);
    const id = await owner();
    const results = await Promise.allSettled([store.save(id, 0, policy), store.save(id, 0, policy)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await store.get(id)).toMatchObject({ revision: 1, pending: false, policy });
    await expect(store.save(id, 0, policy)).rejects.toMatchObject({ status: 409 });
    expect(await store.get(await owner())).toMatchObject({ revision: 0 });
  });
  it("keeps failed desired settings visibly pending without replacing the applied model", async () => {
    const id = await owner();
    await new ModelProviderPolicies(pool, workspace, success).save(id, 0, policy);
    const failing = new ModelProviderPolicies(pool, workspace, async () => new Response("secret detail", { status: 503 }));
    const result = await failing.save(id, 1, { ...policy, model: "openai/unavailable" });
    expect(result).toMatchObject({ revision: 2, pending: true, resolved: { model: policy.model } });
    expect(result.error).not.toContain("secret detail");
  });
  it("keeps team and background settings independent", async () => {
    const calls: string[] = [];
    const store = new ModelProviderPolicies(pool, workspace, async (url, init) => { calls.push(String(url)); return success(url, init); });
    await store.save(undefined, 0, policy, "team");
    await store.save(undefined, 0, { ...policy, effort: "low" }, "background");
    expect((await store.get(undefined, "team")).policy.effort).toBe("high");
    expect((await store.get(undefined, "background")).policy.effort).toBe("low");
    expect(calls.some((url) => url.includes("workload=team"))).toBe(true);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM model_provider_policies WHERE user_id IS NULL")).rows[0].n).toBe(2);
  });
  it("saves independent versioned voice settings", async () => {
    const store = new ModelProviderPolicies(pool, workspace, async (_url, init) => new Response(JSON.stringify(init?.body ? JSON.parse(String(init.body)) : { configured: true })));
    const settings = { realtimeModel: "gpt-realtime-2.1-mini", transcriptionModel: "gpt-transcribe", realtimeVoice: "marin" };
    expect(await store.saveVoice(0, settings)).toMatchObject({ revision: 1, pending: false, ...settings });
    await expect(store.saveVoice(0, settings)).rejects.toMatchObject({ status: 409 });
  });
});
