import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, it, expect } from "vitest";
import { migrations } from "../src/migrations.js";
import { Database } from "../src/database.js";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("shared graph upgrade", () => {
  it("clears old channels and private task content while retaining published comments without exposing staff text", async () => {
    const schema = `graph_upgrade_${randomUUID().replaceAll("-", "")}`;
    const root = new Pool({ connectionString: url });
    await root.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    const db = new Database(pool);
    try {
      await pool.query("CREATE TABLE schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      await pool.query("BEGIN");
      for (const migration of migrations.filter(value => value.version <= 21)) {
        await pool.query(migration.sql);
        await pool.query("INSERT INTO schema_migrations(version) VALUES($1)", [migration.version]);
      }
      await pool.query("COMMIT");
      const owner = await db.createLocalUser({ email: "owner@example.test", displayName: "Owner", passwordHash: "fixture" });
      const privateTask = randomUUID(), sharedTask = randomUUID(), sharedComment = randomUUID(), privateNote = randomUUID();
      for (const [id, kind, data] of [
        [privateTask, "task", { title: "Private task", state: "todo", visibility: "internal" }],
        [privateNote, "note", { title: "Private note", visibility: "shared", parent_id: privateTask }],
        [sharedTask, "task", { title: "Staff title", body: "Private description", acceptance: "Private acceptance", details: { secret: "Private" },
          state: "todo", visibility: "shared", publication: { published: true, title: "Public title", body: "Public description" } }],
        [sharedComment, "comment", { title: "Comment", body: "Retained task history", visibility: "shared", parent_id: sharedTask }],
      ]) await pool.query("INSERT INTO project_items(id,kind,data,author_id) VALUES($1,$2,$3,$4)", [id,kind,data,owner.id]);
      const channel = randomUUID();
      await pool.query("INSERT INTO team_channels(id,name,audience,owner_user_id) VALUES($1,'Old team','restricted',$2)", [channel,owner.id]);
      await pool.query("INSERT INTO team_messages(id,channel_id,author_kind,body) VALUES($1,$2,'system','Old message')", [randomUUID(),channel]);
      await db.migrate();
      expect((await pool.query("SELECT id FROM project_items WHERE id=ANY($1::uuid[])", [[privateTask,privateNote]])).rowCount).toBe(0);
      const retained = (await pool.query("SELECT data FROM project_items WHERE id=$1", [sharedTask])).rows[0].data;
      expect(retained).toMatchObject({ title: "Public title", body: "Public description", acceptance: "", details: {}, publication: null });
      expect((await pool.query("SELECT id FROM project_items WHERE id=$1", [sharedComment])).rowCount).toBe(1);
      expect((await pool.query("SELECT * FROM team_messages")).rowCount).toBe(0);
      const primary = (await pool.query("SELECT * FROM team_channels")).rows;
      expect(primary).toHaveLength(1);
      expect(primary[0]).toMatchObject({ audience: "everyone", import_source: "workspace:primary" });
      await pool.query("INSERT INTO team_messages(id,channel_id,author_kind,body) VALUES($1,$2,'system','New message')", [randomUUID(),primary[0].id]);
      await db.migrate();
      expect((await pool.query("SELECT body FROM team_messages")).rows).toEqual([{ body: "New message" }]);
    } finally {
      await db.close(); await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end();
    }
  });
});
