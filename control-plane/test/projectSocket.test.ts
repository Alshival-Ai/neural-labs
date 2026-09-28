import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { WebSocket } from "ws";
import { expect, it } from "vitest";
import { attachProjectSocket } from "../src/projectSocket.js";
import type { SessionService } from "../src/sessions.js";
import type { ProjectStore } from "../src/projects.js";

it("invalidates both views and closes live sockets when membership ends", async () => {
  let allowed = true; let revision = "1";
  const server = createServer();
  const hub = attachProjectSocket(server,
    { actor: async () => allowed ? { user: { status: "active" } } : undefined } as unknown as SessionService,
    { revision: async () => revision } as unknown as ProjectStore);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sockets = [new WebSocket(origin.replace("http:", "ws:") + "/api/projects/socket", { origin }),
    new WebSocket(origin.replace("http:", "ws:") + "/api/projects/socket", { origin })];
  try {
    await Promise.all(sockets.map(socket => once(socket, "message")));
    const changes = sockets.map(socket => once(socket, "message"));
    revision = "2";
    for (const [payload] of await Promise.all(changes)) expect(JSON.parse(payload.toString())).toEqual({ type: "project.changed", revision: "2" });
    const closed = sockets.map(socket => once(socket, "close"));
    allowed = false;
    for (const [code] of await Promise.all(closed)) expect(code).toBe(4403);
  } finally { sockets.forEach(socket => socket.terminate()); hub.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 10000);
