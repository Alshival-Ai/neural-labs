import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CollaborationStore, TeamMessage } from "../src/collaboration.js";
import { CollaborationSocketHub } from "../src/collaborationSocket.js";
import type { UserRecord } from "../src/types.js";

const actor: UserRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "developer@example.org",
  handle: "developer",
  displayName: "Developer",
  role: "user",
  status: "active",
  createdAt: new Date("2026-09-01T12:00:00.000Z"),
  updatedAt: new Date("2026-09-01T12:00:00.000Z"),
};
const channelId = "22222222-2222-4222-8222-222222222222";
const message: TeamMessage = {
  id: "33333333-3333-4333-8333-333333333333",
  sequence: 1,
  channelId,
  authorKind: "user",
  author: { id: actor.id, handle: actor.handle, displayName: actor.displayName, role: actor.role },
  body: "Hello team",
  attachments: [],
  mentions: [],
  createdAt: "2026-09-01T12:00:00.000Z",
};

const openSockets: WebSocket[] = [];
afterEach(() => {
  for (const socket of openSockets.splice(0)) socket.terminate();
});

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for Team Chat socket message")), 2_000);
    socket.once("message", (raw) => {
      clearTimeout(timeout);
      resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
    });
  });
}

describe("Team Chat WebSocket", () => {
  it("requires an exact same-origin, one-use ticket and returns a membership-scoped snapshot", async () => {
    const ticket = "t".repeat(48);
    let ticketAvailable = true;
    const store = {
      consumeSocketTicket: vi.fn(async (candidate: string) => {
        if (candidate !== ticket || !ticketAvailable) return undefined;
        ticketAvailable = false;
        return actor;
      }),
      listChannels: vi.fn(async () => []),
      directory: vi.fn(async () => []),
      listMessages: vi.fn(async (_actor: UserRecord, requestedChannelId: string) => {
        if (requestedChannelId !== channelId) throw new Error("unexpected channel");
        return [message];
      }),
      canUserAccess: vi.fn(async () => true),
    } as unknown as CollaborationStore;
    const hub = new CollaborationSocketHub(store, vi.fn());
    const server = createServer();
    hub.attach(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    const socketUrl = `ws://127.0.0.1:${address.port}/api/team/socket?ticket=${ticket}`;
    try {
      const socket = new WebSocket(socketUrl, { origin });
      openSockets.push(socket);
      const readyPromise = nextMessage(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      expect(await readyPromise).toMatchObject({ type: "ready", userId: actor.id });

      const snapshotPromise = nextMessage(socket);
      socket.send(JSON.stringify({ type: "subscribe", channelId }));
      expect(await snapshotPromise).toMatchObject({
        type: "snapshot",
        channelId,
        messages: [{ id: message.id, body: "Hello team" }],
      });

      const reused = new WebSocket(socketUrl, { origin });
      reused.on("error", () => undefined);
      const rejected = await new Promise<number>((resolve, reject) => {
        reused.once("unexpected-response", (_request, response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        reused.once("open", () => reject(new Error("A consumed Team Chat ticket was reused")));
      });
      expect(rejected).toBe(401);
    } finally {
      hub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
