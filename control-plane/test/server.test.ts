import { describe, expect, it, vi } from "vitest";
import request from "supertest";

import type { ControlPlaneConfig } from "../src/config.js";
import { hashToken } from "../src/crypto.js";
import type { Database } from "../src/database.js";
import { createApplication } from "../src/server.js";
import type { SessionActor, StoredInstanceConfig, UserRecord } from "../src/types.js";

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
  workspace: {
    statusUrl: new URL("http://workspace:18790/status"),
    controlUrl: new URL("http://workspace:18790/internal/provider-auth/openai"),
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

function actorFor(user: UserRecord): SessionActor {
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
      provider: "local",
      subject: user.email,
      passwordHash: "must-never-be-serialized",
      createdAt: now,
    }],
  };
}

function application(user?: UserRecord) {
  const setUserState = vi.fn(async (_actorId: string, _targetId: string, input: { role?: "admin" | "user"; status?: "pending" | "active" | "rejected" | "disabled" }) => ({
    ...regular,
    ...input,
    updatedAt: now,
  }));
  const database = {
    getSessionActor: vi.fn(async () => user ? actorFor(user) : undefined),
    touchSession: vi.fn(async () => undefined),
    getInstanceConfig: vi.fn(async () => stored),
    listUsers: vi.fn(async () => [
      { ...admin, identities: actorFor(admin).identities },
      { ...regular, identities: actorFor(regular).identities },
    ]),
    listAudit: vi.fn(async () => []),
    getMcpRuntimeConfig: vi.fn(async () => undefined),
    setUserState,
    audit: vi.fn(async () => undefined),
  } as unknown as Database;
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
        }
      : {
          status: "ready",
          openclawVersion: "2026.8.2",
          codexVersion: "0.152.0",
          providerAuthenticated: true,
          codexAuthenticated: true,
          openclawModelReady: true,
        };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return {
    app: createApplication({ database, config, workspaceFetch }).app,
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
});
