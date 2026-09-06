import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CredentialCipher } from "../src/crypto.js";
import { Database } from "../src/database.js";
import { ProviderPluginService, type ProviderRuntimeReport } from "../src/providerPlugins.js";
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration("encrypted API provider configuration", () => {
  let pool: Pool; let admin: Pool; let db: Database; let service: ProviderPluginService;
  const schema = `provider_test_${randomUUID().replaceAll("-", "")}`;
  const report = (revision: number, configured = true): ProviderRuntimeReport => {
    const providers = Object.fromEntries(["google-maps", "klipy", "pexels"].map((id) => [id, { revision, configured, source: "settings" as const, available: true }]));
    return { providers, mcp: providers };
  };
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    db = new Database(pool); await db.migrate();
    service = new ProviderPluginService(pool, new CredentialCipher(Buffer.alloc(32, 7)));
  });
  afterAll(async () => { await db?.close(); if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); } });

  it("encrypts keys and exposes them only through internal runtime configuration", async () => {
    await service.save("klipy", { action: "save", apiKey: "placeholder-api-key" });
    const row = (await pool.query("SELECT * FROM plugin_connections WHERE plugin_id = 'provider-klipy'")).rows[0];
    expect(JSON.stringify(row)).not.toContain("placeholder-api-key");
    expect(row.encrypted_credentials).toContain('"ciphertext"');
    const runtime = await service.runtimeConfig();
    expect(runtime.providers.klipy).toMatchObject({ mode: "settings", revision: 1, apiKey: "placeholder-api-key" });
    const status = await service.status("klipy", false, report(1));
    expect(status).toMatchObject({ editable: false, source: "settings", configured: true, applied: true, state: "configured" });
    expect(JSON.stringify(status)).not.toContain("placeholder-api-key");
  });
  it("tracks both consumers and refuses stale probe results after a rotation", async () => {
    const lagging = report(1); lagging.providers = { ...lagging.providers, klipy: { ...lagging.providers.klipy!, revision: 0 } };
    expect((await service.status("klipy", true, lagging)).state).toBe("applying");
    await service.save("klipy", { action: "save", apiKey: "placeholder-rotated-key" });
    expect(await service.recordCheck("klipy", { revision: 1, capabilities: [{ name: "GIF search", ok: true, message: "Connection works" }] })).toBe(false);
    expect(await service.recordCheck("klipy", { revision: 2, capabilities: [{ name: "GIF search", ok: true, message: "Connection works" }] })).toBe(true);
    expect((await service.status("klipy", true, report(2))).state).toBe("connected");
  });
  it("disconnects without restoring environment keys and supports explicit inheritance", async () => {
    await service.disconnect("klipy");
    expect((await service.runtimeConfig()).providers.klipy).toEqual({ revision: 3, mode: "disabled" });
    const row = (await pool.query("SELECT encrypted_credentials FROM plugin_connections WHERE plugin_id = 'provider-klipy'")).rows[0];
    expect(row.encrypted_credentials).toBeNull();
    expect((await service.status("klipy", true, report(3, false))).state).toBe("disconnected");
    await service.save("klipy", { action: "inherit" });
    expect((await service.runtimeConfig()).providers.klipy).toEqual({ revision: 4, mode: "inherit" });
    expect((await service.status("klipy", true, report(4))).deploymentOverride).toBe(false);
  });
  it("records deployment-only checks without storing the environment secret", async () => {
    expect((await service.runtimeConfig()).providers.pexels).toEqual({ revision: 0, mode: "inherit" });
    expect(await service.recordCheck("pexels", { revision: 0, capabilities: [{ name: "Photo search", ok: true, message: "Connection works" }] })).toBe(true);
    expect((await service.status("pexels", true, report(1))).state).toBe("connected");
    expect((await service.runtimeConfig()).providers.pexels).toEqual({ revision: 1, mode: "inherit" });
  });
});
