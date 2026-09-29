import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../src/database.js";
import { snapshotNativePreservation, prepareNativeChatReset } from "../src/nativePreservation.js";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("native preservation PostgreSQL snapshot", () => {
  const schema = `native_preservation_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool, pool: Pool, database: Database;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    database = new Database(pool); await database.migrate();
  });
  afterAll(async () => {
    await database?.close();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });
  it("retains subscription and uncertain delivery identities without resetting or resending them", async () => {
    const user = await database.createLocalUser({ email: "native-fixture@example.org", displayName: "Native fixture", passwordHash: "fixture-only" });
    const eventId = randomUUID();
    await pool.query("INSERT INTO automation_subscriptions(user_id,job_id,events,channels) VALUES($1,'retained-job',ARRAY['success'],ARRAY['email'])", [user.id]);
    await pool.query("INSERT INTO notification_preferences(user_id,session_key) VALUES($1,'old-chat-reference')", [user.id]);
    await pool.query("INSERT INTO notification_events(id,event_key,job_id,run_id,outcome,title,message) VALUES($1,'retained-event','retained-job','retained-run','success','Fixture','Fixture result')", [eventId]);
    await pool.query("INSERT INTO notification_deliveries(event_id,user_id,channel,status,attempts) VALUES($1,$2,'email','unknown',1)", [eventId, user.id]);
    const before = (await pool.query("SELECT * FROM notification_deliveries")).rows;
    const snapshot = await snapshotNativePreservation(pool);
    expect(snapshot.automation_subscriptions?.[0]?.value.job_id).toBe("retained-job");
    expect(snapshot.notification_deliveries?.[0]?.value.status).toBe("unknown");
    expect(snapshot.notification_events?.[0]?.value.run_id).toBe("retained-run");
    expect(snapshot.notification_preferences?.[0]?.value.session_key).toBe("old-chat-reference");
    expect(snapshot.ownership?.some(row => row.key === `user:${user.id}`)).toBe(true);
    expect((await pool.query("SELECT * FROM notification_deliveries")).rows).toEqual(before);
    const workspace = randomUUID(), input = { workspace, expectedWorkspace: workspace, migration: "a".repeat(64),
      chatResetPolicy: "reset-team-pilot" as const, expectedRecords: snapshot };
    await expect(prepareNativeChatReset(pool, input)).rejects.toThrow("closed admission");
    await pool.query("UPDATE update_runtime SET gate=true WHERE singleton");
    await expect(prepareNativeChatReset(pool, { ...input, expectedWorkspace: randomUUID() })).rejects.toThrow("matching workspace");
    const channel = randomUUID();
    await pool.query("INSERT INTO team_channels(id,owner_user_id,name,audience) VALUES($1,$2,'Retained until reset','everyone')", [channel,user.id]);
    await pool.query("INSERT INTO team_messages(id,channel_id,author_kind,author_user_id,body) VALUES($1,$2,'user',$3,'Fixture message')", [randomUUID(),channel,user.id]);
    const receipt = await prepareNativeChatReset(pool, input);
    expect(receipt.channelsRemoved).toBe(1);
    expect((await pool.query("SELECT * FROM team_messages")).rowCount).toBe(0);
    expect((await pool.query("SELECT session_key FROM notification_preferences")).rows[0].session_key).toBeNull();
    expect((await pool.query("SELECT * FROM notification_deliveries")).rows).toEqual(before);
    expect((await pool.query("SELECT * FROM automation_subscriptions")).rowCount).toBe(1);
    expect(await prepareNativeChatReset(pool,input)).toEqual(receipt);
    await pool.query("UPDATE notification_preferences SET session_key='new-chat'");
    await expect(prepareNativeChatReset(pool,input)).rejects.toThrow("changed since export");
    expect((await pool.query("SELECT session_key FROM notification_preferences")).rows[0].session_key).toBe("new-chat");
  });
  it("preserves customer Team Chat and notification references without inheriting pilot reset consent", async () => {
    const user = await database.createLocalUser({ email: "preserved-fixture@example.org", displayName: "Preserved", passwordHash: "fixture-only" });
    const channel = randomUUID(), message = randomUUID();
    await pool.query("INSERT INTO team_channels(id,owner_user_id,name,audience) VALUES($1,$2,'Preserved','everyone')", [channel,user.id]);
    await pool.query("INSERT INTO team_messages(id,channel_id,author_kind,author_user_id,body) VALUES($1,$2,'user',$3,'Keep this message')", [message,channel,user.id]);
    await pool.query("UPDATE update_runtime SET gate=true WHERE singleton");
    const expectedRecords = await snapshotNativePreservation(pool), workspace = randomUUID();
    const input = { workspace, expectedWorkspace: workspace, migration: "b".repeat(64), chatResetPolicy: "preserve" as const, expectedRecords };
    const result = await prepareNativeChatReset(pool,input);
    expect(result.channelsRemoved).toBe(0);
    expect((await pool.query("SELECT body FROM team_messages WHERE id=$1",[message])).rows[0]?.body).toBe("Keep this message");
    expect(await snapshotNativePreservation(pool)).toEqual(expectedRecords);
    expect(await prepareNativeChatReset(pool,input)).toEqual(result);
  });
});
