import express from "express";
import request from "supertest";
import type { ControlPlaneConfig } from "../src/config.js";
import { registerProjectTransferRoutes } from "../src/projectTransferRoutes.js";
import { createHmac, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { Database } from "../src/database.js";
import { ProjectTransferStore, canonical, checksum, transferInput } from "../src/projectTransfer.js";
import { ProjectStore } from "../src/projects.js";

(process.env.TEST_DATABASE_URL ? describe : describe.skip)("verified project transfers", () => {
  let root: Pool, database: Database, store: ProjectTransferStore, schema: string;
  beforeEach(async () => {
    root = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    schema = `transfer_${randomUUID().replaceAll("-", "")}`;
    await root.query(`CREATE SCHEMA ${schema}`);
    database = new Database(new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` }));
    await database.migrate(); store = new ProjectTransferStore(database.pool);
  });
  afterEach(async () => { await database.close(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end(); });
  function fixture() {
    const id = randomUUID(), author = randomUUID(), item = randomUUID();
    const records = [
      { key: `principal:${author}`, source: {}, principal: { id: author, display_name: "Historical author" } },
      { key: `item:${item}`, source: { original: "Preserve source history" }, item: { id: item, kind: "task", revision: 3,
        data: { title: "Imported work" }, author_id: author, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-02T00:00:00Z" } },
    ];
    const manifest = checksum(records.map(record => [record.key, checksum(record)]).sort(([a], [b]) => a! < b! ? -1 : 1));
    const call = (operation: string, extra = {}) => store.execute(transferInput.parse({ id, generation: 2, operation, ...extra }));
    return { id, author, item, records, manifest, call };
  }
  it("requires a fresh signature bound to the exact instance and body", async () => {
    const managed = { workspace: randomUUID(), instance: randomUUID(), portalOrigin: "https://portal.example.test", secret: "fixture-secret" };
    const app = express(); app.use(express.json()); registerProjectTransferRoutes(app, database, { managed } as ControlPlaneConfig);
    const body = { id: randomUUID(), generation: 2, operation: "status" };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", managed.secret).update(`${managed.workspace}\n${managed.instance}\n${timestamp}\n${canonical(body)}`).digest("hex");
    expect((await request(app).post("/internal/projects/transfer").send(body)).status).toBe(403);
    expect((await request(app).post("/internal/projects/transfer").set("x-project-time", timestamp).set("x-project-signature", signature).send({ ...body, generation: 3 })).status).toBe(403);
    expect((await request(app).post("/internal/projects/transfer").set("x-project-time", "1000000000").set("x-project-signature", signature).send(body)).status).toBe(403);
    expect((await request(app).post("/internal/projects/transfer").set("x-project-time", timestamp).set("x-project-signature", signature).send(body)).body.error).toBe("transfer_binding");
  });
  it("requires a complete manifest, accepts identical retries and refuses divergent records", async () => {
    const f = fixture();
    await f.call("begin", { count: 2, manifest: f.manifest });
    await f.call("batch", { records: f.records.slice(0, 1) });
    await expect(f.call("verify")).rejects.toMatchObject({ code: "manifest_mismatch" });
    await expect(f.call("activate")).rejects.toMatchObject({ code: "verification_required" });
    await f.call("batch", { records: f.records });
    await f.call("batch", { records: f.records });
    await expect(f.call("batch", { records: [{ ...f.records[0], source: { changed: true } }] })).rejects.toMatchObject({ code: "record_conflict" });
    await f.call("verify"); await f.call("activate"); await f.call("activate");
    expect((await database.pool.query("SELECT count(*)::int AS count FROM project_items")).rows[0].count).toBe(1);
    expect((await database.getUser(f.author))?.status).toBe("disabled");
    expect((await database.pool.query("SELECT data FROM project_items")).rows[0].data.title).toBe("Imported work");
  });
  it("freezes current edits, includes new authors and events, and binds retirement to the export hash", async () => {
    const f = fixture(); await f.call("begin", { count: 2, manifest: f.manifest });
    await f.call("batch", { records: f.records }); await f.call("verify"); await f.call("activate");
    const user = await database.createLocalUser({ email: "new@example.test", displayName: "New member", passwordHash: "fixture" });
    await database.pool.query("UPDATE users SET status='active' WHERE id=$1", [user.id]); user.status = "active";
    const projects = new ProjectStore(database.pool);
    await projects.mutate(user, "create", null, { idempotency_key: randomUUID(), kind: "note", data: { title: "New content" } });
    const id = randomUUID();
    const call = (operation: string, extra = {}) => store.execute(transferInput.parse({ id, generation: 3, operation, ...extra }));
    const frozen = await call("freeze");
    await expect(projects.mutate(user, "create", null, { idempotency_key: randomUUID(), kind: "note", data: { title: "Blocked" } })).rejects.toMatchObject({ status: 423 });
    const exported = { records: [] as Array<{key: string; principal?: {id: string}}> };
    let after: string | null = "";
    do { const page = await call("export", { after }); exported.records.push(...page.records); after = page.next; } while (after);
    expect(exported.records.some((r: {principal?: {id: string}}) => r.principal?.id === user.id)).toBe(true);
    expect(exported.records.some((r: {key: string}) => r.key.startsWith("event:"))).toBe(true);
    expect(checksum(exported.records.map((r: {key: string}) => [r.key, checksum(r)]))).toBe(frozen.manifest);
    await expect(call("retire", { manifest: "0".repeat(64) })).rejects.toMatchObject({ code: "manifest_mismatch" });
    await call("retire", { manifest: frozen.manifest }); await call("retire", { manifest: frozen.manifest });
    await expect(call("resume")).rejects.toMatchObject({ code: "cannot_resume" });
    await expect(f.call("activate")).rejects.toMatchObject({ code: "transfer_superseded" });
  });
  it("rejects cycles and absent principals without activating the destination", async () => {
    const f = fixture();
    f.records[1]!.item!.data = { title: "Cycle", parent_id: f.item } as {title: string};
    const manifest = checksum(f.records.map(record => [record.key, checksum(record)]).sort(([a], [b]) => a! < b! ? -1 : 1));
    await f.call("begin", { count: 2, manifest }); await f.call("batch", { records: f.records });
    await expect(f.call("verify")).rejects.toMatchObject({ code: "invalid_hierarchy" });
    expect((await database.pool.query("SELECT count(*)::int AS count FROM project_items")).rows[0].count).toBe(0);
  });
});
