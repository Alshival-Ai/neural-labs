import { randomBytes } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { terminalActor } from "./terminal-manager.mjs";
import { nativeLoginUrl } from "./claude-accounts.mjs";

export const CLAUDE_LOGIN_SOCKET_PATH = "/workspace/api/claude-login/socket";
export const CLAUDE_LOGIN_SOCKET_PROTOCOL = "neural-claude-login.v1";

// Tickets and native login output remain in memory, outside terminal history.
export function attachClaudeLoginWebSocket(server, { accounts, publicOrigin, resolveActor = async () => null, now = Date.now, heartbeatMs = 25_000 }) {
  const tickets = new Map();
  const sessions = new Map();
  const sockets = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 16 * 1024,
    handleProtocols: protocols => protocols.has(CLAUDE_LOGIN_SOCKET_PROTOCOL) ? CLAUDE_LOGIN_SOCKET_PROTOCOL : false });
  const cleanupTickets = () => { for (const [key, ticket] of tickets) if (ticket.expiresAt <= now()) tickets.delete(key); };
  const allowed = async ticket => {
    const actor = await resolveActor(ticket.actorId);
    return actor?.id === ticket.actorId && (ticket.owner.userId ? ticket.owner.userId === actor.id : actor.role === "admin");
  };
  const getLogin = ticket => accounts.loginSession(ticket.agentId, ticket.attemptId, ticket.actorId);
  const reject = socket => { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); };
  const onUpgrade = (request, socket, head) => {
    if (new URL(request.url, publicOrigin).pathname !== CLAUDE_LOGIN_SOCKET_PATH) return;
    void (async () => {
      const actor = terminalActor(request.headers);
      if (!actor || request.headers.origin !== publicOrigin) return reject(socket);
      const protocols = String(request.headers["sec-websocket-protocol"] ?? "").split(",").map(value => value.trim());
      const token = protocols.find(value => value.startsWith("ticket."))?.slice(7);
      const ticket = tickets.get(token);
      tickets.delete(token);
      if (!protocols.includes(CLAUDE_LOGIN_SOCKET_PROTOCOL) || !ticket || ticket.expiresAt <= now() || ticket.actorId !== actor.id || !await allowed(ticket)) return reject(socket);
      const login = getLogin(ticket);
      if (login.listeners.size >= 2) return reject(socket);
      sockets.handleUpgrade(request, socket, head, connection => sockets.emit("connection", connection, ticket));
    })().catch(() => reject(socket));
  };
  server.on("upgrade", onUpgrade);
  sockets.on("connection", (socket, ticket) => {
    const login = getLogin(ticket);
    const state = { ticket, alive: true, checking: false };
    sessions.set(socket, state);
    const send = message => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 256 * 1024) { socket.close(1008, "Sign-in terminal is too slow"); return; }
      socket.send(JSON.stringify(message));
    };
    const listener = message => {
      send(message);
      if (message.type === "finished") socket.close(1000, "Sign-in finished");
    };
    login.listeners.add(listener);
    send({ type: "ready", data: login.output, verificationUrl: nativeLoginUrl(login.output) });
    let windowStart = now(), messageCount = 0, inputBytes = 0;
    socket.on("message", (raw, binary) => {
      try {
        if (binary) throw new Error();
        if (now() - windowStart >= 60_000) { windowStart = now(); messageCount = 0; inputBytes = 0; }
        if (++messageCount > 3000 || (inputBytes += raw.length) > 256 * 1024) throw new Error();
        const current = getLogin(ticket);
        const message = JSON.parse(raw.toString("utf8"));
        if (message.type === "input" && typeof message.data === "string" && message.data.length <= 8192) current.child.write(message.data);
        else if (message.type === "resize" && Number.isInteger(message.cols) && message.cols >= 20 && message.cols <= 240 && Number.isInteger(message.rows) && message.rows >= 6 && message.rows <= 100) current.child.resize(message.cols, message.rows);
        else throw new Error();
      } catch { socket.close(1008, "Invalid or expired sign-in input"); }
    });
    socket.on("pong", () => { state.alive = true; });
    const detach = () => { login.listeners.delete(listener); sessions.delete(socket); };
    socket.once("close", detach); socket.once("error", detach);
  });
  const heartbeat = setInterval(() => {
    cleanupTickets();
    for (const [socket, state] of sessions) {
      if (!state.alive) { socket.terminate(); continue; }
      state.alive = false; socket.ping();
      if (state.checking) continue;
      state.checking = true;
      void allowed(state.ticket).then(valid => {
        if (!valid) throw new Error();
        getLogin(state.ticket);
      }).catch(() => socket.close(1008, "Sign-in access expired")).finally(() => { state.checking = false; });
    }
  }, heartbeatMs);
  heartbeat.unref?.();
  return {
    async issueTicket(owner, input, actorId) {
      cleanupTickets();
      const ticket = { owner, actorId, attemptId: input?.attemptId, expiresAt: now() + 60_000 };
      if (typeof ticket.attemptId !== "string" || !await allowed(ticket)) throw new Error("Sign-in access denied");
      ticket.agentId = await accounts.owner(owner);
      getLogin(ticket);
      if ([...tickets.values()].filter(value => value.actorId === actorId).length >= 8) throw new Error("Too many sign-in tickets");
      const token = randomBytes(32).toString("base64url");
      tickets.set(token, ticket);
      return { ticket: token, expiresAt: ticket.expiresAt, path: CLAUDE_LOGIN_SOCKET_PATH, protocol: CLAUDE_LOGIN_SOCKET_PROTOCOL };
    },
    close() {
      clearInterval(heartbeat); tickets.clear(); server.off("upgrade", onUpgrade);
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
    },
  };
}
