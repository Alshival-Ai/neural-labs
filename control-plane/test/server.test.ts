import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHmac } from "node:crypto";

import type { ControlPlaneConfig } from "../src/config.js";
import type { CollaborationStore } from "../src/collaboration.js";
import { hashToken } from "../src/crypto.js";
import type { Database } from "../src/database.js";
import { createApplication } from "../src/server.js";
import type { WebAuthnOperations } from "../src/passkeys.js";
import type { PasskeyRecord, SessionActor, StoredInstanceConfig, UserRecord } from "../src/types.js";

const now = new Date("2026-09-01T12:00:00.000Z");
const admin: UserRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.org",
  handle: "admin-user",
  displayName: "Admin User",
  role: "admin",
  status: "active",
  createdAt: now,
  updatedAt: now,
};
const regular: UserRecord = {
  ...admin,
  id: "22222222-2222-4222-8222-222222222222",
  email: "user@example.org",
  handle: "regular-user",
  displayName: "Regular User",
  role: "user",
};
const stored: StoredInstanceConfig = {
  setupComplete: true,
  publicOrigin: "https://neural-labs.example.org",
  localAuthEnabled: true,
  microsoftAuthEnabled: false,
  microsoftMcpEnabled: false,
  entraAuthorityHost: "https://login.microsoftonline.com",
  configVersion: 2,
  createdAt: now,
  updatedAt: now,
};
const config: ControlPlaneConfig = {
  host: "127.0.0.1",
  port: 4174,
  publicOrigin: new URL("https://neural-labs.example.org"),
  database: {
    host: "postgres",
    port: 5432,
    database: "neural_labs",
    user: "neural_labs",
    password: "test-password",
    ssl: false,
  },
  masterKey: Buffer.alloc(32, 4),
  mcpConfigToken: "mcp-config-token-at-least-thirty-two-characters",
  turn: {
    urls: ["stun:neural-labs.example.org:3478", "turn:neural-labs.example.org:3478?transport=udp", "turn:neural-labs.example.org:3478?transport=tcp"],
    secret: "turn-test-secret-at-least-thirty-two-characters",
  },
  workspace: {
    statusUrl: new URL("http://workspace:18790/status"),
    controlUrl: new URL("http://workspace:18790/internal/provider-auth/openai"),
    personalAuthUrl: new URL("http://workspace:18790/internal/provider-auth/openai/users"),
    teamAgentUrl: new URL("http://workspace:18790/internal/neura/team-run"),
    controlToken: "workspace-control-token-at-least-thirty-two-characters",
    openclawVersion: "2026.8.2",
    codexVersion: "0.152.0",
  },
  autoSetup: true,
  initialAdminEmail: admin.email,
  setupDefaults: {
    localAuthEnabled: true,
    microsoftAuthEnabled: false,
    microsoftMcpEnabled: false,
  },
  secureCookies: true,
};

function actorFor(user: UserRecord, microsoftLinked = false): SessionActor {
  return {
    user,
    session: {
      tokenHash: hashToken("session-token"),
      userId: user.id,
      csrfHash: hashToken("csrf-token"),
      idleExpiresAt: new Date(now.getTime() + 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 120_000),
      createdAt: now,
      lastSeenAt: now,
    },
    identities: [{
      id: "33333333-3333-4333-8333-333333333333",
      userId: user.id,
      provider: microsoftLinked ? "microsoft" : "local",
      subject: microsoftLinked ? `tenant:${user.id}` : user.email,
      ...(microsoftLinked ? { tenantId: "tenant" } : { passwordHash: "must-never-be-serialized" }),
      createdAt: now,
    }],
  };
}

const passkey: PasskeyRecord = {
  id: "44444444-4444-4444-8444-444444444444",
  userId: regular.id,
  credentialId: "credential-id",
  webauthnUserId: "webauthn-user-id",
  publicKey: new Uint8Array([1, 2, 3]),
  counter: 1,
  deviceType: "multiDevice",
  backedUp: true,
  transports: ["internal"],
  displayName: "Laptop passkey",
  createdAt: now,
};

function application(user?: UserRecord, microsoftLinked = false, collaboration?: CollaborationStore) {
  const setUserState = vi.fn(async (_actorId: string, _targetId: string, input: { role?: "admin" | "user"; status?: "pending" | "active" | "rejected" | "disabled" }) => ({
    ...regular,
    ...input,
    updatedAt: now,
  }));
  const database = {
    getSessionActor: vi.fn(async () => user ? actorFor(user, microsoftLinked) : undefined),
    touchSession: vi.fn(async () => undefined),
    createSession: vi.fn(async () => undefined),
    getInstanceConfig: vi.fn(async () => stored),
    listUsers: vi.fn(async () => [
      { ...admin, identities: actorFor(admin).identities },
      { ...regular, identities: actorFor(regular).identities },
    ]),
    listAudit: vi.fn(async () => []),
    getMcpRuntimeConfig: vi.fn(async () => undefined),
    setUserState,
    audit: vi.fn(async () => undefined),
    consumeRateLimit: vi.fn(async () => true),
    listPasskeys: vi.fn(async () => []),
    savePasskeyChallenge: vi.fn(async () => undefined),
    consumePasskeyChallenge: vi.fn(async () => ({
      tokenHash: "challenge-token-hash",
      challenge: "expected-challenge",
      kind: "authentication" as const,
      expiresAt: new Date(now.getTime() + 300_000),
    })),
    findPasskeyByCredentialId: vi.fn(async (credentialId: string) => credentialId === passkey.credentialId ? { passkey, user: regular } : undefined),
    createPasskey: vi.fn(async (input: Omit<PasskeyRecord, "id" | "createdAt" | "lastUsedAt">) => ({ ...input, id: passkey.id, createdAt: now })),
    updatePasskeyUsage: vi.fn(async () => undefined),
    deletePasskey: vi.fn(async () => true),
  } as unknown as Database;
  const webauthn = {
    registrationOptions: vi.fn(async () => ({
      options: {
        challenge: "registration-challenge",
        rp: { name: "Neural Labs", id: "neural-labs.example.org" },
        user: { id: "webauthn-user-id", name: regular.email, displayName: regular.displayName },
        pubKeyCredParams: [],
      },
      webauthnUserId: "webauthn-user-id",
    })),
    verifyRegistration: vi.fn(async () => ({
      credentialId: passkey.credentialId,
      publicKey: passkey.publicKey,
      counter: passkey.counter,
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
      transports: passkey.transports,
    })),
    authenticationOptions: vi.fn(async () => ({
      challenge: "authentication-challenge",
      rpId: "neural-labs.example.org",
      allowCredentials: [],
      userVerification: "required" as const,
    })),
    verifyAuthentication: vi.fn(async () => ({ newCounter: 2, backedUp: true })),
  } as unknown as WebAuthnOperations;
  const workspaceFetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    const payload = url.includes("/internal/provider-auth/openai")
      ? {
          provider: "openai",
          authMethod: "chatgpt",
          state: url.endsWith("/start") ? "starting" : "disconnected",
          authenticated: false,
          modelReady: false,
          verificationUrl: null,
          userCode: null,
          expiresAt: null,
          message: null,
          ...(url.includes("/users/") ? { agentId: `nl-${regular.id.replaceAll("-", "")}`, paused: false } : {}),
        }
      : {
          status: "ready",
          openclawVersion: "2026.8.2",
          codexVersion: "0.152.0",
          providerAuthenticated: true,
          codexAuthenticated: true,
          openclawModelReady: true,
          mcp: {
            ready: true,
            mode: "workspace-local",
            endpoint: "http://127.0.0.1:8792/mcp",
            transport: "streamable-http",
            agentServerName: "neural-labs-tools",
            agentScope: "shared-workspace",
            publicAccess: false,
            providers: { googlePlaces: true, googleGeocoding: true, klipy: true, pexels: true },
            tools: ["google_places_search", "google_geocode_address", "search_gif", "pexels_search_photos"],
          },
        };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return {
    app: createApplication({ database, config, workspaceFetch, webauthn, ...(collaboration ? { collaboration } : {}) }).app,
    database,
    webauthn,
    setUserState,
    workspaceFetch,
  };
}

const cookies = ["__Host-neural-labs-session=session-token", "neural-labs-csrf=csrf-token"];

describe("control-plane JSON and role routing", () => {
  it("returns an anonymous session without redirecting", async () => {
    const { app } = application();
    await request(app).get("/api/session").expect(200, { authenticated: false });
  });

  it("returns only safe session and user-list fields", async () => {
    const { app } = application(admin);
    const session = await request(app).get("/api/session").set("Cookie", cookies).expect(200);
    expect(session.body).toMatchObject({
      authenticated: true,
      user: { email: admin.email, role: "admin", status: "active" },
      providers: ["local"],
      csrfToken: "csrf-token",
      neura: { agentId: `nl-${admin.id.replaceAll("-", "")}` },
    });
    const users = await request(app).get("/api/admin/users").set("Cookie", cookies).expect(200);
    expect(users.text).not.toContain("must-never-be-serialized");
    expect(users.text).not.toContain('"subject"');
    expect(users.body.users[0]).toMatchObject({ providers: ["local"] });
  });

  it("requires the matching CSRF header for admin mutations", async () => {
    const { app, setUserState } = application(admin);
    await request(app)
      .patch(`/api/admin/users/${regular.id}`)
      .set("Cookie", cookies)
      .set("Accept", "application/json")
      .send({ status: "active" })
      .expect(403);
    await request(app)
      .patch(`/api/admin/users/${regular.id}`)
      .set("Cookie", cookies)
      .set("Accept", "application/json")
      .set("X-CSRF-Token", "csrf-token")
      .send({ status: "active" })
      .expect(200);
    expect(setUserState).toHaveBeenCalledOnce();
  });

  it("scopes personal OpenAI device login to the authenticated user", async () => {
    const instance = application(regular);
    const status = await request(instance.app).get("/api/account/openai").set("Cookie", cookies).expect(200);
    expect(status.body).toMatchObject({ provider: "openai", agentId: `nl-${regular.id.replaceAll("-", "")}` });

    await request(instance.app).post("/api/account/openai/connect").set("Cookie", cookies).expect(403);
    await request(instance.app)
      .post("/api/account/openai/connect")
      .set("Cookie", cookies)
      .set("X-CSRF-Token", "csrf-token")
      .expect(202);
    const personalCalls = instance.workspaceFetch.mock.calls.filter(([input]) => String(input).includes("/users/"));
    expect(String(personalCalls[0]?.[0])).toContain(`/users/${regular.id}`);
    expect(String(personalCalls[1]?.[0])).toContain(`/users/${regular.id}/start`);
    expect(new Headers(personalCalls[1]?.[1]?.headers).get("Authorization")).toBe(`Bearer ${config.workspace.controlToken}`);
  });

  it("keeps administrator data unavailable to regular workspace users", async () => {
    const { app } = application(regular);
    await request(app).get("/api/admin/overview").set("Cookie", cookies).expect(403);
    await request(app).get("/api/admin/users").set("Cookie", cookies).expect(403);
  });

  it("routes every active user and retired admin page to the shared desktop", async () => {
    const regularApplication = application(regular);
    await request(regularApplication.app).get("/login").set("Cookie", cookies).expect(303).expect("Location", "/workspace");
    await request(regularApplication.app).get("/account").set("Cookie", cookies).expect(303).expect("Location", "/workspace?settings=personalization");
    await request(regularApplication.app).get("/admin/mcp").set("Cookie", cookies).expect(303).expect("Location", "/workspace");

    const adminApplication = application(admin);
    await request(adminApplication.app).get("/login").set("Cookie", cookies).expect(303).expect("Location", "/workspace");
    await request(adminApplication.app).get("/admin/users").set("Cookie", cookies).expect(303).expect("Location", "/workspace");
  });

  it("authorizes active users for workspace ingress with immutable identity headers", async () => {
    const { app } = application(regular);
    const authorized = await request(app)
      .get("/internal/workspace/auth")
      .set("Cookie", cookies)
      .set("X-Neural-Labs-User", "spoofed")
      .expect(204);
    expect(authorized.headers["x-neural-labs-user"]).toBe(regular.id);
    expect(authorized.headers["x-neural-labs-email"]).toBe(regular.email);
    expect(authorized.headers["x-neural-labs-role"]).toBe("user");

    await request(application().app)
      .get("/internal/workspace/auth")
      .expect(401)
      .expect("X-Neural-Labs-Redirect", "/login?error=Please+log+in");
  });

  it("issues short-lived pseudonymous TURN credentials only to the workspace", async () => {
    const { app } = application();
    await request(app)
      .post("/internal/turn-credentials")
      .send({ actorId: regular.id })
      .expect(401);

    const result = await request(app)
      .post("/internal/turn-credentials")
      .set("Authorization", `Bearer ${config.workspace.controlToken}`)
      .send({ actorId: regular.id })
      .expect(200);
    expect(result.body.iceServers[0]).toEqual({ urls: ["stun:neural-labs.example.org:3478"] });
    const relay = result.body.iceServers[1];
    expect(relay.urls).toHaveLength(2);
    expect(relay.username).toMatch(/^\d+:[a-f0-9]{20}$/);
    expect(relay.credential).toBe(createHmac("sha1", config.turn!.secret).update(relay.username).digest("base64"));
    expect(JSON.stringify(result.body)).not.toContain(config.turn!.secret);
    expect(relay.username).not.toContain(regular.id);
  });

  it("answers Team Terminal membership checks only for the trusted workspace", async () => {
    const channelId = "55555555-5555-4555-8555-555555555555";
    const teamTerminalAccess = vi.fn(async () => ({
      allowed: true as const,
      channel: { id: channelId, name: "Private release", audience: "restricted" as const },
    }));
    const collaboration = { teamTerminalAccess } as unknown as CollaborationStore;
    const { app } = application(undefined, false, collaboration);

    await request(app).post("/internal/team-terminal/access").send({ actorId: regular.id, channelId }).expect(401);
    const result = await request(app)
      .post("/internal/team-terminal/access")
      .set("Authorization", `Bearer ${config.workspace.controlToken}`)
      .send({ actorId: regular.id, channelId })
      .expect(200);

    expect(result.body).toEqual({ allowed: true, channel: { id: channelId, name: "Private release", audience: "restricted" } });
    expect(teamTerminalAccess).toHaveBeenCalledWith(channelId, regular.id);
  });

  it("reserves the automation administration ingress for active administrators", async () => {
    await request(application(regular).app)
      .get("/internal/workspace/admin-auth")
      .set("Cookie", cookies)
      .expect(403);

    const authorized = await request(application(admin).app)
      .get("/internal/workspace/admin-auth")
      .set("Cookie", cookies)
      .expect(204);
    expect(authorized.headers["x-neural-labs-user"]).toBe(admin.id);
    expect(authorized.headers["x-neural-labs-role"]).toBe("admin");

    await request(application().app)
      .get("/internal/workspace/admin-auth")
      .expect(401)
      .expect("X-Neural-Labs-Redirect", "/login?error=Please+log+in");
  });

  it("reports shared workspace readiness to active users", async () => {
    const { app } = application(regular);
    const response = await request(app).get("/api/workspace").set("Cookie", cookies).expect(200);
    expect(response.body).toMatchObject({
      status: "ready",
      shared: true,
      persistent: true,
      codexAuthenticated: true,
      openclawModelReady: true,
      publicUrl: "https://neural-labs.example.org/workspace",
    });
  });

  it("reports the display-safe plugin catalog to active members", async () => {
    const { app } = application(regular);
    const response = await request(app).get("/api/plugins").set("Cookie", cookies).expect(200);
    expect(response.body.plugins).toHaveLength(1);
    expect(response.body.plugins[0]).toMatchObject({
      id: "neural-labs-tools",
      type: "mcp",
      scope: "global",
      ownership: "system",
      editable: false,
      ready: true,
      mcp: { agentServerName: "neural-labs-tools", publicAccess: false },
    });
    expect(response.body.plugins[0].mcp.tools).toContain("search_gif");
    await request(application().app).get("/api/plugins").expect(401);
  });

  it("reports the workspace-local MCP without exposing legacy public controls", async () => {
    const { app } = application(admin);
    const response = await request(app).get("/api/admin/mcp").set("Cookie", cookies).expect(200);
    expect(response.body).toMatchObject({
      ready: true,
      mode: "workspace-local",
      endpoint: "http://127.0.0.1:8792/mcp",
      agentServerName: "neural-labs-tools",
      agentScope: "shared-workspace",
      publicAccess: false,
      providers: { googlePlaces: true, googleGeocoding: true, klipy: true, pexels: true },
    });
    expect(response.body.tools).toContain("search_gif");
    expect(response.body).not.toHaveProperty("publicUrl");
    await request(app)
      .put("/api/admin/mcp")
      .set("Cookie", cookies)
      .set("X-CSRF-Token", "csrf-token")
      .send({ enabled: true })
      .expect(404);
  });

  it("lets only an administrator start workspace-owned ChatGPT device login", async () => {
    const regularApplication = application(regular);
    await request(regularApplication.app)
      .post("/api/admin/workspace/provider/connect")
      .set("Cookie", cookies)
      .set("X-CSRF-Token", "csrf-token")
      .send({})
      .expect(403);
    expect(regularApplication.workspaceFetch).not.toHaveBeenCalled();

    const adminApplication = application(admin);
    const response = await request(adminApplication.app)
      .post("/api/admin/workspace/provider/connect")
      .set("Cookie", cookies)
      .set("X-CSRF-Token", "csrf-token")
      .send({})
      .expect(202);
    expect(response.body).toMatchObject({
      provider: "openai",
      authMethod: "chatgpt",
      state: "starting",
      authenticated: false,
    });
    const requestOptions = adminApplication.workspaceFetch.mock.calls[0]?.[1];
    expect(requestOptions?.method).toBe("POST");
    expect(new Headers(requestOptions?.headers).get("authorization")).toBe(
      "Bearer workspace-control-token-at-least-thirty-two-characters",
    );
  });

  it("routes pending users to their restricted account page", async () => {
    const { app } = application({ ...regular, status: "pending" });
    await request(app)
      .get("/login")
      .set("Cookie", cookies)
      .expect(303)
      .expect("Location", "/account/pending");
  });

  it("requires a linked Microsoft identity and CSRF before passkey enrollment", async () => {
    const localOnly = application(regular);
    await request(localOnly.app)
      .post("/api/account/passkeys/registration/options")
      .set("Cookie", cookies)
      .set("X-CSRF-Token", "csrf-token")
      .send({})
      .expect(403, { error: { code: "microsoft_required", message: "Sign in with Microsoft before creating a passkey." } });
    expect(localOnly.webauthn.registrationOptions).not.toHaveBeenCalled();

    const microsoft = application(regular, true);
    await request(microsoft.app)
      .post("/api/account/passkeys/registration/options")
      .set("Cookie", cookies)
      .send({})
      .expect(403);
    await request(microsoft.app)
      .post("/api/account/passkeys/registration/options")
      .set("Cookie", cookies)
      .set("X-CSRF-Token", "csrf-token")
      .send({})
      .expect(200);
    expect(microsoft.webauthn.registrationOptions).toHaveBeenCalledWith(
      new URL("https://neural-labs.example.org"),
      regular,
      [],
    );
  });

  it("stores a verified passkey for the Microsoft-bootstrapped account", async () => {
    const instance = application(regular, true);
    const response = await request(instance.app)
      .post("/api/account/passkeys/registration/verify")
      .set("Cookie", cookies)
      .set("X-CSRF-Token", "csrf-token")
      .send({
        transaction: "valid-passkey-transaction-token",
        name: "Laptop passkey",
        response: {
          id: "credential-id",
          rawId: "credential-id",
          type: "public-key",
          response: { clientDataJSON: "client-data", attestationObject: "attestation", transports: ["internal"] },
          clientExtensionResults: {},
          authenticatorAttachment: "platform",
        },
      })
      .expect(201);

    expect(response.body.passkey).toMatchObject({ name: "Laptop passkey", backedUp: true });
    expect(response.text).not.toContain("publicKey");
    expect(response.text).not.toContain("credential-id");
    expect(instance.database.consumePasskeyChallenge).toHaveBeenCalledWith(
      hashToken("valid-passkey-transaction-token"),
      "registration",
      regular.id,
    );
    expect(instance.database.createPasskey).toHaveBeenCalledWith(expect.objectContaining({
      userId: regular.id,
      credentialId: "credential-id",
      displayName: "Laptop passkey",
    }));
  });

  it("authenticates a discoverable passkey with a consumed one-use challenge", async () => {
    const instance = application();
    const options = await request(instance.app)
      .post("/api/auth/passkey/options")
      .send({})
      .expect(200);
    expect(options.body.options).toMatchObject({ challenge: "authentication-challenge", allowCredentials: [] });

    const login = await request(instance.app)
      .post("/api/auth/passkey/verify")
      .send({
        transaction: "valid-passkey-transaction-token",
        response: {
          id: "credential-id",
          rawId: "credential-id",
          type: "public-key",
          response: {
            clientDataJSON: "client-data",
            authenticatorData: "authenticator-data",
            signature: "signature",
            userHandle: "webauthn-user-id",
          },
          clientExtensionResults: {},
          authenticatorAttachment: "platform",
        },
      })
      .expect(200);

    expect(login.body).toMatchObject({ user: { id: regular.id }, redirectTo: "/workspace" });
    expect(instance.database.consumePasskeyChallenge).toHaveBeenCalledWith(
      hashToken("valid-passkey-transaction-token"),
      "authentication",
    );
    expect(instance.webauthn.verifyAuthentication).toHaveBeenCalledWith(
      new URL("https://neural-labs.example.org"),
      expect.objectContaining({ id: "credential-id" }),
      "expected-challenge",
      passkey,
    );
    expect(instance.database.updatePasskeyUsage).toHaveBeenCalledWith(passkey.id, 2, true);
    expect(instance.database.createSession).toHaveBeenCalledOnce();
  });
});
