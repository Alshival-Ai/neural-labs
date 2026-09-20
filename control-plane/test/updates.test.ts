import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { updatePolicySchema, defaultUpdatePolicy, validUpdateTransition, UpdateService } from "../src/updates.js";
import { registerUpdateRoutes, updateTokenMatches } from "../src/updateRoutes.js";
import type { SessionActor } from "../src/types.js";

describe("update trust boundaries", () => {
  it("validates timezone, window, days and strict policy fields", () => {
    expect(updatePolicySchema.parse(defaultUpdatePolicy)).toEqual(defaultUpdatePolicy);
    for (const bad of [{ timezone: "Mars/Olympus" }, { start: "25:00" }, { days: [] }, { days: [0, 0] }, { end: "02:00" }, { image: "anything" }])
      expect(updatePolicySchema.safeParse({ ...defaultUpdatePolicy, ...bad }).success).toBe(false);
  });
  it("separates updater tokens from workspace tokens and fails closed on empty credentials", () => {
    expect(updateTokenMatches("Bearer " + "a".repeat(32), "a".repeat(32))).toBe(true);
    expect(updateTokenMatches("Bearer " + "b".repeat(32), "a".repeat(32))).toBe(false);
    expect(updateTokenMatches("Bearer ", "")).toBe(false);
    expect(validUpdateTransition("committing", "restoring")).toBe(false);
    expect(validUpdateTransition("restoring", "recovery_required")).toBe(true);
  });
  it("requires admin, CSRF and same origin; never accepts a client-supplied image", async () => {
    const app = express(); app.use(express.json());
    const service = { status: vi.fn(async () => ({})), save: vi.fn(async () => ({})), enqueue: vi.fn(async () => ({ id: "test" })), workerState: vi.fn(async () => ({})) };
    registerUpdateRoutes(app, service as unknown as UpdateService, {
      admin: async (req, res) => { if (req.get("test-role") !== "admin") { res.sendStatus(403); return undefined; } return { user: { id: "actor" } } as SessionActor; },
      active: async () => undefined,
      csrf: (req, res) => { if (req.get("x-csrf-token") !== "synthetic") { res.sendStatus(403); return false; } return true; },
      sameOrigin: (req, res, next) => { if (req.get("origin") !== "https://example.org") res.sendStatus(403); else next(); },
      workerToken: "w".repeat(32), workspaceToken: "s".repeat(32),
    });
    expect((await request(app).get("/api/admin/updates")).status).toBe(403);
    expect((await request(app).post("/api/admin/updates/install").set("test-role", "admin").set("origin", "https://example.org").send({})).status).toBe(403);
    expect((await request(app).post("/api/admin/updates/install").set("test-role", "admin").set("origin", "https://other.example.org").set("x-csrf-token", "synthetic").send({})).status).toBe(403);
    expect((await request(app).post("/api/admin/updates/install").set("test-role", "admin").set("origin", "https://example.org").set("x-csrf-token", "synthetic").send({ image: "evil:latest" })).status).toBe(422);
    expect(service.enqueue).not.toHaveBeenCalled();
    expect((await request(app).get("/internal/updates/worker").set("Authorization", "Bearer " + "s".repeat(32))).status).toBe(401);
    expect((await request(app).get("/internal/updates/worker").set("Authorization", "Bearer " + "w".repeat(32))).status).toBe(200);
  });
});
