import type { IncomingMessage, Server } from "node:http";

import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";

import { CollaborationError, TEAM_CHAT_LIMITS, type CollaborationStore, type TeamAgentRun } from "./collaboration.js";
import type { CollaborationEvent } from "./server.js";
import type { UserRecord } from "./types.js";

const clientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribe"), channelId: z.string().uuid() }),
  z.object({ type: z.literal("typing"), channelId: z.string().uuid(), active: z.boolean() }),
  z.object({ type: z.literal("mark_read"), channelId: z.string().uuid(), sequence: z.number().int().min(0) }),
  z.object({
    type: z.literal("post"),
    channelId: z.string().uuid(),
    clientRequestId: z.string().uuid(),
    body: z.string().max(TEAM_CHAT_LIMITS.messageCharacters).default(""),
    attachments: z.array(z.object({
      path: z.string().trim().min(1).max(1_024),
      name: z.string().trim().min(1).max(255),
      type: z.string().trim().max(255).optional(),
      size: z.number().int().min(0).max(10 * 1024 * 1024 * 1024).optional(),
    })).max(TEAM_CHAT_LIMITS.attachmentsPerMessage).default([]),
  }),
]);

type TeamSocket = WebSocket & {
  actor: UserRecord;
  channelId?: string | undefined;
  alive: boolean;
};

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function rejectUpgrade(request: IncomingMessage, socket: import("node:stream").Duplex, status: number, message: string): void {
  const body = `${message}\n`;
  socket.write(
    `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Forbidden"}\r\n` +
    "Connection: close\r\n" +
    "Content-Type: text/plain; charset=utf-8\r\n" +
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.destroy();
}

export class CollaborationSocketHub {
  private readonly sockets = new Set<TeamSocket>();
  private readonly webSockets = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    private readonly store: CollaborationStore,
    private readonly onAgentRun: (run: TeamAgentRun & { capability: string }) => void,
  ) {
    this.webSockets.on("connection", (connection) => this.connected(connection as TeamSocket));
    this.heartbeat = setInterval(() => {
      for (const socket of this.sockets) {
        if (!socket.alive) {
          socket.terminate();
          continue;
        }
        socket.alive = false;
        socket.ping();
      }
    }, 30_000);
    this.heartbeat.unref();
  }

  attach(server: Server): void {
    server.on("upgrade", (request, socket, head) => {
      void this.upgrade(request, socket, head);
    });
  }

  private async upgrade(request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/team/socket") return rejectUpgrade(request, socket, 403, "Unknown WebSocket endpoint");
    const forwardedProto = String(request.headers["x-forwarded-proto"] ?? "http").split(",")[0]!.trim();
    const forwardedHost = String(request.headers["x-forwarded-host"] ?? request.headers.host ?? "").split(",")[0]!.trim();
    const expectedOrigin = `${forwardedProto}://${forwardedHost}`;
    if (!forwardedHost || request.headers.origin !== expectedOrigin) {
      return rejectUpgrade(request, socket, 403, "WebSocket origin rejected");
    }
    const ticket = url.searchParams.get("ticket") ?? "";
    if (ticket.length < 32 || ticket.length > 512) return rejectUpgrade(request, socket, 401, "Invalid WebSocket ticket");
    let actor: UserRecord | undefined;
    try {
      actor = await this.store.consumeSocketTicket(ticket);
    } catch {
      return rejectUpgrade(request, socket, 401, "Invalid WebSocket ticket");
    }
    if (!actor) return rejectUpgrade(request, socket, 401, "Expired WebSocket ticket");
    this.webSockets.handleUpgrade(request, socket, head, (connection) => {
      const teamSocket = connection as TeamSocket;
      teamSocket.actor = actor!;
      this.webSockets.emit("connection", teamSocket, request);
    });
  }

  private connected(socket: TeamSocket): void {
    socket.alive = true;
    this.sockets.add(socket);
    socket.on("pong", () => { socket.alive = true; });
    socket.on("close", () => {
      this.sockets.delete(socket);
      if (socket.channelId) this.broadcastTyping(socket, socket.channelId, false);
    });
    socket.on("message", (raw, binary) => {
      if (binary) return send(socket, { type: "error", code: "invalid_event", message: "Binary messages are not supported." });
      void this.receive(socket, raw.toString());
    });
    void Promise.all([this.store.listChannels(socket.actor), this.store.directory()])
      .then(([channels, users]) => send(socket, { type: "ready", userId: socket.actor.id, channels, users }))
      .catch(() => socket.close(1011, "Collaboration unavailable"));
  }

  private async receive(socket: TeamSocket, raw: string): Promise<void> {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      send(socket, { type: "error", code: "invalid_json", message: "Send a JSON event." });
      return;
    }
    const parsed = clientEventSchema.safeParse(value);
    if (!parsed.success) {
      send(socket, { type: "error", code: "invalid_event", message: "That collaboration event is invalid." });
      return;
    }
    try {
      const event = parsed.data;
      if (event.type === "subscribe") {
        const messages = await this.store.listMessages(socket.actor, event.channelId, undefined, TEAM_CHAT_LIMITS.messagesPerPage);
        if (socket.channelId && socket.channelId !== event.channelId) {
          this.broadcastTyping(socket, socket.channelId, false);
        }
        socket.channelId = event.channelId;
        send(socket, { type: "snapshot", channelId: event.channelId, messages });
        return;
      }
      if (event.type === "typing") {
        if (socket.channelId !== event.channelId || !(await this.store.canUserAccess(event.channelId, socket.actor.id))) {
          throw new CollaborationError(404, "channel_not_found", "Team channel not found.");
        }
        this.broadcastTyping(socket, event.channelId, event.active);
        return;
      }
      if (event.type === "mark_read") {
        await this.store.markRead(socket.actor, event.channelId, event.sequence);
        return;
      }
      const result = await this.store.postMessage(socket.actor, event);
      await this.publish({ type: "message.created", channelId: event.channelId, message: result.message });
      await this.publish({ type: "channels.changed", channelId: event.channelId });
      send(socket, { type: "post.accepted", clientRequestId: event.clientRequestId, messageId: result.message.id });
      if (result.run) {
        const { capability: _capability, ...publicAgentRun } = result.run;
        await this.publish({ type: "agent.status", channelId: event.channelId, run: publicAgentRun });
        this.onAgentRun(result.run);
      }
    } catch (error) {
      if (error instanceof CollaborationError) {
        send(socket, { type: "error", code: error.code, message: error.message });
      } else {
        send(socket, { type: "error", code: "internal_error", message: "The collaboration request failed." });
      }
    }
  }

  private broadcastTyping(source: TeamSocket, channelId: string, active: boolean): void {
    for (const socket of this.sockets) {
      if (socket !== source && socket.channelId === channelId) {
        send(socket, { type: "typing", channelId, user: { id: source.actor.id, handle: source.actor.handle, displayName: source.actor.displayName }, active });
      }
    }
  }

  async publish(event: CollaborationEvent): Promise<void> {
    if (event.type === "channels.changed") {
      for (const socket of this.sockets) send(socket, event);
      return;
    }
    await Promise.all([...this.sockets].map(async (socket) => {
      if (socket.channelId !== event.channelId) return;
      if (await this.store.canUserAccess(event.channelId, socket.actor.id)) send(socket, event);
      else {
        socket.channelId = undefined;
        send(socket, { type: "membership.revoked", channelId: event.channelId });
      }
    }));
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const socket of this.sockets) socket.terminate();
    this.webSockets.close();
  }
}
