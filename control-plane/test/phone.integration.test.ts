import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../src/database.js";
import { PhoneStore } from "../src/phone.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)(
  "PostgreSQL phone verification",
  () => {
    const schema = `phone_test_${randomUUID().replaceAll("-", "")}`;
    let admin: Pool, pool: Pool, database: Database, store: PhoneStore;
    const digest = "ab".repeat(32);
    beforeAll(async () => {
      admin = new Pool({ connectionString: databaseUrl });
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema}`,
      });
      database = new Database(pool);
      await database.migrate();
      store = new PhoneStore(pool);
    });
    afterAll(async () => {
      if (database) await database.close();
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.end();
      }
    });
    async function user() {
      return (
        await database.createLocalUser({
          email: `${randomUUID()}@example.org`,
          displayName: "Phone test",
          passwordHash: "test-only",
        })
      ).id;
    }
    async function begin(id: string, number = "+12025550123") {
      const challenge = randomUUID();
      expect(await store.reserve(id, number, challenge, digest)).toBe(true);
      await store.delivered(id, challenge);
      return challenge;
    }
    it("consumes a code exactly once even with concurrent verification", async () => {
      const id = await user();
      const challenge = await begin(id);
      expect((await store.get(id)).phoneNumber).toBeNull();
      const results = await Promise.all([
        store.verify(id, challenge, digest),
        store.verify(id, challenge, digest),
      ]);
      expect(results.sort()).toEqual([false, true]);
      expect(await store.get(id)).toMatchObject({
        phoneNumber: "+12025550123",
        pending: null,
      });
      await store.remove(id);
      expect(await store.get(id)).toMatchObject({
        phoneNumber: null,
        pending: null,
      });
      expect(
        await store.reserve(id, "+12025550124", randomUUID(), digest),
      ).toBe(false);
    });
    it("enforces ownership, five attempts, expiration and provider acceptance", async () => {
      const id = await user(),
        other = await user();
      const challenge = await begin(id);
      expect(await store.verify(other, challenge, digest)).toBe(false);
      for (let n = 0; n < 5; n++)
        expect(await store.verify(id, challenge, "cd".repeat(32))).toBe(false);
      expect(await store.verify(id, challenge, digest)).toBe(false);
      expect((await store.get(id)).pending?.attemptsRemaining).toBe(0);
      const expiredId = await user(),
        expiredChallenge = await begin(expiredId);
      await pool.query(
        "UPDATE user_phones SET expires_at = now() - interval '1 second' WHERE user_id = $1",
        [expiredId],
      );
      expect(await store.verify(expiredId, expiredChallenge, digest)).toBe(
        false,
      );
      const unaccepted = await user(),
        unacceptedChallenge = randomUUID();
      await store.reserve(
        unaccepted,
        "+12025550123",
        unacceptedChallenge,
        digest,
      );
      expect(await store.verify(unaccepted, unacceptedChallenge, digest)).toBe(
        false,
      );
    });
    it("preserves verified numbers through replacement/cancel and rejects old challenges", async () => {
      const id = await user();
      const first = await begin(id, "+12025550130");
      expect(await store.verify(id, first, digest)).toBe(true);
      await pool.query(
        "UPDATE user_phones SET sent_at = now() - interval '61 seconds' WHERE user_id = $1",
        [id],
      );
      const replacement = await begin(id, "+12025550131");
      expect((await store.get(id)).phoneNumber).toBe("+12025550130");
      await store.cancel(id, first);
      expect((await store.get(id)).pending?.challengeId).toBe(replacement);
      expect(await store.verify(id, first, digest)).toBe(false);
      await store.cancel(id, replacement);
      expect(await store.get(id)).toMatchObject({
        phoneNumber: "+12025550130",
        pending: null,
      });
    });
    it("atomically limits resends and prevents duplicate verified phone numbers", async () => {
      const id = await user();
      const reserves = await Promise.all([
        store.reserve(id, "+12025550140", randomUUID(), digest),
        store.reserve(id, "+12025550140", randomUUID(), digest),
      ]);
      expect(reserves.sort()).toEqual([false, true]);
      const challenge = (await store.get(id)).pending!.challengeId;
      await store.delivered(id, challenge);
      expect(await store.verify(id, challenge, digest)).toBe(true);
      const other = await user();
      const second = await begin(other, "+12025550140");
      await expect(store.verify(other, second, digest)).rejects.toMatchObject({
        code: "phone_unavailable",
        status: 409,
      });
      expect((await store.get(other)).phoneNumber).toBeNull();
    });
  },
);
