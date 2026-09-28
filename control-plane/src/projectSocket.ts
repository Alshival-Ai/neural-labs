/** Revision-only live feed. Content is fetched through the authorized project API. */
import type { Server } from "node:http";
import type { Request } from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { SessionService } from "./sessions.js";
import type { ProjectStore } from "./projects.js";

export function attachProjectSocket(server: Server, sessions: SessionService, store: ProjectStore) {
  const hub = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on("upgrade", (req, socket, head) => {
    if (req.url?.split("?")[0] !== "/api/projects/socket") return;
    const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0]!.trim();
    const host = req.headers.host;
    if (!host || req.headers.origin !== `${proto}://${host}`) { socket.destroy(); return; }
    void sessions.actor(req as Request).then(actor => {
      if (!actor || actor.user.status !== "active") { socket.destroy(); return; }
      hub.handleUpgrade(req, socket, head, connection => {
        let last = "";
        let running = false;
        const tick = async () => {
          if (running || connection.readyState !== WebSocket.OPEN) return;
          running = true;
          try {
            const current = await sessions.actor(req as Request);
            if (!current || current.user.status !== "active") { connection.close(4403, "Access ended"); return; }
            const revision = await store.revision();
            if (revision !== last) { connection.send(JSON.stringify({ type: "project.changed", revision })); last = revision; }
          } catch { connection.close(1013, "Project service unavailable"); }
          finally { running = false; }
        };
        const timer = setInterval(() => { void tick(); }, 1500);
        timer.unref();
        connection.on("close", () => clearInterval(timer));
        connection.on("error", () => clearInterval(timer));
        connection.on("message", () => connection.close(1008, "Use the project API for mutations"));
        void tick();
      });
    }).catch(() => socket.destroy());
  });
  return { close: () => { for (const socket of hub.clients) socket.close(1001); hub.close(); } };
}
