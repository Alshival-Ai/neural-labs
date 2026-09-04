import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Database } from "../src/database.js";
import { CollaborationStore } from "../src/collaboration.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("PostgreSQL account state", () => {
  const schema = `control_test_${randomUUID().replaceAll("-", "")}`;
  let adminPool: Pool;
  let pool: Pool;
  let database: Database;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: databaseUrl });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    database = new Database(pool);
    await database.migrate();
  });

  afterAll(async () => {
    if (database) await database.close();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await adminPool.end();
    }
  });

  it("atomically assigns exactly one first administrator", async () => {
    const [first, second] = await Promise.all([
      database.createLocalUser({
        email: "first@example.com",
        displayName: "First",
        passwordHash: "hash-one",
      }),
      database.createLocalUser({
        email: "second@example.com",
        displayName: "Second",
        passwordHash: "hash-two",
      }),
    ]);
    const users = [first, second];
    expect(users.filter((user) => user.role === "admin" && user.status === "active")).toHaveLength(1);
    expect(users.filter((user) => user.role === "user" && user.status === "pending")).toHaveLength(1);
  });

  it("prevents removal of the last active administrator", async () => {
    const users = await database.listUsers();
    const admin = users.find((user) => user.role === "admin")!;
    await expect(database.setUserState(admin.id, admin.id, { role: "user" })).rejects.toThrow(
      /administrator/,
    );
  });

  it("allows only the configured email to claim an otherwise unclaimed instance", async () => {
    const restrictedSchema = `restricted_${randomUUID().replaceAll("-", "")}`;
    await adminPool.query(`CREATE SCHEMA ${restrictedSchema}`);
    const restrictedPool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${restrictedSchema}`,
    });
    const restricted = new Database(restrictedPool);
    try {
      await restricted.migrate();
      const pending = await restricted.createLocalUser(
        {
          email: "visitor@example.org",
          displayName: "Visitor",
          passwordHash: "hash-visitor",
        },
        "owner@example.org",
      );
      const owner = await restricted.createLocalUser(
        {
          email: "owner@example.org",
          displayName: "Owner",
          passwordHash: "hash-owner",
        },
        "owner@example.org",
      );
      expect(pending).toMatchObject({ role: "user", status: "pending" });
      expect(owner).toMatchObject({ role: "admin", status: "active" });
    } finally {
      await restricted.close();
      await adminPool.query(`DROP SCHEMA ${restrictedSchema} CASCADE`);
    }
  });

  it("stores and consumes opaque session state", async () => {
    const user = (await database.listUsers())[0]!;
    await database.createSession({
      tokenHash: "session-hash",
      csrfHash: "csrf-hash",
      userId: user.id,
      idleExpiresAt: new Date(Date.now() + 60_000),
      absoluteExpiresAt: new Date(Date.now() + 120_000),
    });
    expect((await database.getSessionActor("session-hash"))?.user.id).toBe(user.id);
    await database.deleteSession("session-hash");
    expect(await database.getSessionActor("session-hash")).toBeUndefined();
  });

  it("stores passkey public material and consumes registration challenges once", async () => {
    const user = (await database.listUsers())[0]!;
    const created = await database.createPasskey({
      userId: user.id,
      credentialId: "integration-credential",
      webauthnUserId: "integration-user",
      publicKey: new Uint8Array([1, 2, 3, 4]),
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      transports: ["internal", "hybrid"],
      displayName: "Integration passkey",
    });
    expect((await database.listPasskeys(user.id))[0]).toMatchObject({
      credentialId: "integration-credential",
      displayName: "Integration passkey",
      backedUp: true,
    });
    expect((await database.findPasskeyByCredentialId("integration-credential"))?.user.id).toBe(user.id);

    await database.savePasskeyChallenge({
      tokenHash: "passkey-challenge-hash",
      challenge: "passkey-challenge",
      kind: "registration",
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await database.consumePasskeyChallenge("passkey-challenge-hash", "registration", user.id)).toMatchObject({
      challenge: "passkey-challenge",
      userId: user.id,
    });
    expect(await database.consumePasskeyChallenge("passkey-challenge-hash", "registration", user.id)).toBeUndefined();

    await database.updatePasskeyUsage(created.id, 2, true);
    expect((await database.listPasskeys(user.id))[0]).toMatchObject({ counter: 2 });
    expect(await database.deletePasskey(user.id, created.id)).toBe(true);
    expect(await database.findPasskeyByCredentialId("integration-credential")).toBeUndefined();
  });

  it("enforces Team Chat membership and scopes Neura capabilities to one channel", async () => {
    const collaborationSchema = `collaboration_${randomUUID().replaceAll("-", "")}`;
    await adminPool.query(`CREATE SCHEMA ${collaborationSchema}`);
    const collaborationPool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${collaborationSchema}`,
    });
    const collaborationDatabase = new Database(collaborationPool);
    try {
      await collaborationDatabase.migrate();
      const owner = await collaborationDatabase.createLocalUser({
        email: "owner@example.org",
        displayName: "Owner",
        passwordHash: "hash-owner",
      });
      const pendingMember = await collaborationDatabase.createLocalUser({
        email: "member@example.org",
        displayName: "Member",
        passwordHash: "hash-member",
      });
      const pendingOutsider = await collaborationDatabase.createLocalUser({
        email: "outsider@example.org",
        displayName: "Outsider",
        passwordHash: "hash-outsider",
      });
      const member = (await collaborationDatabase.setUserState(owner.id, pendingMember.id, { status: "active" }))!;
      const outsider = (await collaborationDatabase.setUserState(owner.id, pendingOutsider.id, { status: "active" }))!;
      const store = new CollaborationStore(collaborationDatabase.pool);

      const created = await store.createChannel(owner, {
        name: "Release room",
        audience: "restricted",
        memberIds: [member.id],
      });
      expect(await store.teamTerminalAccess(created.channel.id, owner.id)).toMatchObject({ allowed: true, channel: { name: "Release room", audience: "restricted" } });
      expect(await store.teamTerminalAccess(created.channel.id, member.id)).toMatchObject({ allowed: true, channel: { id: created.channel.id } });
      expect(await store.teamTerminalAccess(created.channel.id, outsider.id)).toBeUndefined();
      await expect(store.listMessages(outsider, created.channel.id)).rejects.toMatchObject({
        status: 404,
        code: "channel_not_found",
      });

      const posted = await store.postMessage(member, {
        channelId: created.channel.id,
        body: `(@${owner.handle}), please review this with @Neura.`,
        attachments: [],
        clientRequestId: randomUUID(),
      });
      expect(posted.message.mentions).toEqual([owner.id]);
      expect(posted.run?.status).toBe("queued");
      expect((await store.listChannels(owner))[0]).toMatchObject({ unreadCount: 1, mentionCount: 1 });

      const capability = posted.run!.capability;
      expect(await store.claimRun(posted.run!.id)).toMatchObject({ status: "running" });
      expect((await store.channelForCapability(capability)).id).toBe(created.channel.id);
      const response = await store.postAgentMessage(capability, "The release looks ready.", [{ path: "reports/release.png", name: "release.png", type: "image/png", size: 2048 }]);
      expect(response).toMatchObject({ channelId: created.channel.id, authorKind: "neura", attachments: [{ path: "reports/release.png", type: "image/png" }] });
      await store.saveRunActivities(posted.run!.id, [{
        kind: "command", title: "Command completed", command: "release-check", output: "token=must-not-leak", state: "done",
      }]);
      expect(await store.agentMessage(posted.run!.id)).toMatchObject({
        activities: [{ kind: "command", command: "release-check", output: "token=[redacted]", state: "done" }],
      });
      await store.finishRun(posted.run!.id);
      await expect(store.channelForCapability(capability)).rejects.toMatchObject({
        status: 403,
        code: "agent_capability_invalid",
      });
    } finally {
      await collaborationDatabase.close();
      await adminPool.query(`DROP SCHEMA IF EXISTS ${collaborationSchema} CASCADE`);
    }
  });
});
