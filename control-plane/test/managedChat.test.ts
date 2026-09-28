import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerManagedChat, validBridgeSignature } from "../src/managedChat.js";
import type { ControlPlaneConfig } from "../src/config.js";
import type { Database } from "../src/database.js";
import type { CollaborationStore } from "../src/collaboration.js";

describe("optional shared-chat bridge", () => {
  it("authenticates the exact payload and rejects stale and tampered requests", () => {
    const payload = JSON.stringify({ operation: "history", token: "fixture" });
    const stamp = String(Math.floor(Date.now() / 1000));
    const sign = (time: string, value: string) => createHmac("sha256", "fixture-secret").update(`chat\n${time}\n${value}`).digest("hex");
    expect(validBridgeSignature("fixture-secret", stamp, payload, sign(stamp, payload))).toBe(true);
    expect(validBridgeSignature("fixture-secret", stamp, payload + " ", sign(stamp, payload))).toBe(false);
    const old = String(Number(stamp) - 60);
    expect(validBridgeSignature("fixture-secret", old, payload, sign(old, payload))).toBe(false);
    expect(validBridgeSignature("fixture-secret", stamp, payload, "invalid")).toBe(false);
  });
  it("is absent from standalone installations and rejects unsigned managed requests before database access", async () => {
    const standalone = express(); standalone.use(express.json());
    const managed = express(); managed.use(express.json());
    const database = { pool: { query: vi.fn() } };
    for (const [app, config] of [[standalone, {}], [managed, { managed: { secret: "fixture" } }]] as const)
      registerManagedChat(app, config as ControlPlaneConfig, database as unknown as Database,
        {} as CollaborationStore, vi.fn(), vi.fn(), vi.fn());
    expect((await request(standalone).post("/api/alshival/chat-bridge").send({ payload: "{}" })).status).toBe(404);
    expect((await request(managed).post("/api/alshival/chat-bridge").send({ payload: "{}" })).status).toBe(403);
    expect(database.pool.query).not.toHaveBeenCalled();
  });
});
