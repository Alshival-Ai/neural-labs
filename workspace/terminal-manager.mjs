import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import * as pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";

export const TERMINAL_SOCKET_PATH = "/workspace/api/terminals/socket";
export const TERMINAL_SOCKET_PROTOCOL = "neural-terminal.v1";

const MAX_PERSONAL_SESSIONS = 8;
const MAX_TEAM_SESSIONS = 8;
const MAX_TOTAL_SESSIONS = 32;
const MAX_CONNECTIONS_PER_SESSION = 16;
const MAX_BACKLOG_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_BUFFERED_SOCKET_BYTES = 1024 * 1024;
const TICKET_TTL_MS = 60_000;
const HEARTBEAT_MS = 25_000;
const TEAM_REACTIONS = new Set(["👍", "🎉", "🚀", "🔥", "❤️", "👏", "😂", "👀"]);
const REACTION_COOLDOWN_MS = 400;

export class TerminalError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "TerminalError";
    this.status = status;
    this.code = code;
  }
}

export class WorkspaceTerminalManager {
  constructor({
    workspaceRoot,
    shell = existsSync("/usr/bin/zsh") ? "/usr/bin/zsh" : "/bin/bash",
    now = Date.now,
    spawnPty = (file, args, options) => pty.spawn(file, args, options),
  } = {}) {
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    this.workspaceRoot = workspaceRoot;
    this.shell = shell;
    this.now = now;
    this.spawnPty = spawnPty;
    this.sessions = new Map();
    this.tickets = new Map();
    this.cleanupTimer = setInterval(() => this.cleanupTickets(), 30_000);
    this.cleanupTimer.unref?.();
  }

  list(actor) {
    return [...this.sessions.values()]
      .filter((session) => this.canAccess(actor, session))
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((session) => this.snapshot(actor, session));
  }

  create(actor, input = {}) {
    if (this.sessions.size >= MAX_TOTAL_SESSIONS) {
      throw new TerminalError(429, "terminal_limit_reached", "The workspace terminal limit has been reached");
    }
    const scope = input.scope === "team" ? "team" : "personal";
    if (scope === "personal") {
      const personalCount = [...this.sessions.values()].filter((session) => session.scope === "personal" && session.ownerId === actor.id).length;
      if (personalCount >= MAX_PERSONAL_SESSIONS) {
        throw new TerminalError(429, "terminal_limit_reached", "Close a personal terminal before opening another");
      }
    } else {
      const teamCount = [...this.sessions.values()].filter((session) => session.scope === "team").length;
      if (teamCount >= MAX_TEAM_SESSIONS) {
        throw new TerminalError(429, "terminal_limit_reached", "End a Team Terminal before opening another");
      }
    }

    const size = normalizeSize(input.cols, input.rows);
    const defaultIndex = [...this.sessions.values()].filter((session) => session.scope === scope).length + 1;
    const title = normalizeTitle(input.title, scope === "team" ? `Team shell ${defaultIndex}` : `shell ${defaultIndex}`);
    const terminalId = randomUUID();
    let processHandle;
    try {
      processHandle = this.spawnPty(this.shell, shellArguments(this.shell), {
        name: "xterm-256color",
        cols: size.cols,
        rows: size.rows,
        cwd: this.workspaceRoot,
        env: terminalEnvironment(this.shell, this.workspaceRoot, { actor, scope, terminalId }),
      });
    } catch (error) {
      console.error("Workspace PTY failed to start", error instanceof Error ? error.message : error);
      throw new TerminalError(503, "terminal_unavailable", "The terminal could not be started");
    }

    const timestamp = this.now();
    const session = {
      id: terminalId,
      title,
      scope,
      ownerId: actor.id,
      ownerLabel: actor.label,
      process: processHandle,
      status: "running",
      createdAt: timestamp,
      lastActivityAt: timestamp,
      cols: size.cols,
      rows: size.rows,
      sequence: 0,
      backlogBytes: 0,
      backlog: [],
      connections: new Map(),
      controllerConnectionId: null,
      exitCode: null,
      exitSignal: null,
    };

    processHandle.onData((data) => this.recordOutput(session, String(data ?? "")));
    processHandle.onExit(({ exitCode, signal }) => {
      session.status = "exited";
      session.exitCode = Number.isInteger(exitCode) ? exitCode : null;
      session.exitSignal = Number.isInteger(signal) ? signal : null;
      session.lastActivityAt = this.now();
      this.broadcast(session, {
        type: "exit",
        exitCode: session.exitCode,
        signal: session.exitSignal,
      });
    });
    this.sessions.set(session.id, session);
    return this.snapshot(actor, session);
  }

  get(actor, terminalId) {
    const session = this.sessions.get(String(terminalId ?? ""));
    return session && this.canAccess(actor, session) ? session : null;
  }

  issueTicket(actor, terminalId, afterSequence) {
    const session = this.get(actor, terminalId);
    if (!session) throw new TerminalError(404, "terminal_not_found", "Terminal session not found");
    if (session.connections.size >= MAX_CONNECTIONS_PER_SESSION) {
      throw new TerminalError(429, "terminal_connection_limit", "This terminal has too many connected viewers");
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + TICKET_TTL_MS;
    this.tickets.set(token, {
      actor: { ...actor },
      terminalId: session.id,
      afterSequence: normalizeSequence(afterSequence),
      expiresAt,
    });
    return { ticket: token, expiresAt };
  }

  consumeTicket(actorId, token) {
    const normalized = String(token ?? "");
    const ticket = this.tickets.get(normalized);
    this.tickets.delete(normalized);
    if (!ticket || ticket.expiresAt <= this.now() || ticket.actor.id !== actorId) return null;
    const session = this.sessions.get(ticket.terminalId);
    if (!session || !this.canAccess(ticket.actor, session)) return null;
    return { ticket, session };
  }

  attach(session, actor, socket) {
    const connection = {
      id: randomUUID(),
      actor: { ...actor },
      socket,
      connectedAt: this.now(),
      lastTypingAt: 0,
      lastReactionAt: 0,
    };
    session.connections.set(connection.id, connection);
    if (session.scope === "team" && !session.controllerConnectionId) {
      session.controllerConnectionId = connection.id;
    }
    this.broadcastPresence(session);
    return connection;
  }

  detach(session, connection) {
    if (!session.connections.delete(connection.id)) return;
    if (session.controllerConnectionId === connection.id) {
      session.controllerConnectionId = session.connections.keys().next().value ?? null;
    }
    this.broadcastPresence(session);
  }

  input(session, connection, data) {
    if (session.status !== "running") return;
    if (session.scope === "team" && session.controllerConnectionId !== connection.id) return;
    const input = String(data ?? "");
    if (!input || Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) return;
    session.lastActivityAt = this.now();
    session.process.write(input);
    const timestamp = this.now();
    if (session.scope === "team" && timestamp - connection.lastTypingAt >= 500) {
      connection.lastTypingAt = timestamp;
      this.broadcast(session, {
        type: "input-activity",
        actor: { id: connection.actor.id, label: connection.actor.label },
        at: timestamp,
      });
    }
  }

  resize(session, connection, cols, rows) {
    if (session.status !== "running") return false;
    if (session.scope === "team" && session.controllerConnectionId !== connection.id) return false;
    const size = normalizeSize(cols, rows);
    if (size.cols === session.cols && size.rows === session.rows) return true;
    session.cols = size.cols;
    session.rows = size.rows;
    session.process.resize(size.cols, size.rows);
    this.broadcastLayout(session);
    return true;
  }

  claimControl(session, connection) {
    if (session.scope !== "team") return;
    session.controllerConnectionId = connection.id;
    this.broadcastPresence(session);
  }

  react(session, connection, value) {
    if (session.scope !== "team") return;
    const emoji = String(value ?? "");
    const timestamp = this.now();
    if (!TEAM_REACTIONS.has(emoji) || timestamp - connection.lastReactionAt < REACTION_COOLDOWN_MS) return;
    connection.lastReactionAt = timestamp;
    this.broadcast(session, {
      type: "reaction",
      id: randomUUID(),
      emoji,
      actor: { id: connection.actor.id, label: connection.actor.label },
      at: timestamp,
    });
  }

  close(actor, terminalId) {
    const session = this.get(actor, terminalId);
    if (!session) return false;
    if (session.scope === "team" && actor.id !== session.ownerId && actor.role !== "admin") {
      throw new TerminalError(403, "terminal_forbidden", "Only the creator or an administrator can end this Team Terminal");
    }
    this.sessions.delete(session.id);
    for (const [token, ticket] of this.tickets) {
      if (ticket.terminalId === session.id) this.tickets.delete(token);
    }
    this.broadcast(session, { type: "closed" });
    for (const connection of session.connections.values()) {
      connection.socket.close(1000, "Terminal ended");
    }
    session.connections.clear();
    if (session.status === "running") session.process.kill();
    return true;
  }

  replay(session, afterSequence) {
    const firstSequence = session.backlog[0]?.sequence ?? session.sequence + 1;
    if (afterSequence !== null && afterSequence >= firstSequence - 1 && afterSequence <= session.sequence) {
      return {
        mode: "resume",
        sequence: session.sequence,
        chunks: session.backlog.filter((chunk) => chunk.sequence > afterSequence),
      };
    }
    return {
      mode: "replay",
      sequence: session.sequence,
      data: session.backlog.map((chunk) => chunk.data).join(""),
    };
  }

  snapshot(actor, session) {
    const controller = session.connections.get(session.controllerConnectionId);
    return {
      id: session.id,
      title: session.title,
      scope: session.scope,
      shell: path.basename(session.process?.process || this.shell),
      cwd: "~/workspace",
      status: session.status,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      cols: session.cols,
      rows: session.rows,
      sequence: session.sequence,
      exitCode: session.exitCode,
      owner: { label: session.ownerLabel },
      owned: session.ownerId === actor.id,
      canTerminate: session.scope === "personal" || session.ownerId === actor.id || actor.role === "admin",
      participants: participants(session),
      controller: terminalController(controller),
    };
  }

  cleanupTickets() {
    const timestamp = this.now();
    for (const [token, ticket] of this.tickets) {
      if (ticket.expiresAt <= timestamp) this.tickets.delete(token);
    }
  }

  shutdown() {
    clearInterval(this.cleanupTimer);
    for (const session of [...this.sessions.values()]) {
      this.close({ id: session.ownerId, role: "admin", label: session.ownerLabel }, session.id);
    }
    this.tickets.clear();
  }

  canAccess(actor, session) {
    return session.scope === "team" || session.ownerId === actor.id;
  }

  recordOutput(session, data) {
    if (!data) return;
    session.sequence += 1;
    session.lastActivityAt = this.now();
    const chunk = { sequence: session.sequence, data, bytes: Buffer.byteLength(data, "utf8") };
    session.backlog.push(chunk);
    session.backlogBytes += chunk.bytes;
    while (session.backlogBytes > MAX_BACKLOG_BYTES && session.backlog.length > 1) {
      const removed = session.backlog.shift();
      session.backlogBytes -= removed.bytes;
    }
    this.broadcast(session, { type: "output", sequence: chunk.sequence, data: chunk.data });
  }

  broadcast(session, payload) {
    const encoded = JSON.stringify(payload);
    for (const connection of session.connections.values()) {
      const socket = connection.socket;
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (socket.bufferedAmount > MAX_BUFFERED_SOCKET_BYTES) {
        socket.close(1013, "Terminal client fell behind");
        continue;
      }
      socket.send(encoded);
    }
  }

  broadcastPresence(session) {
    const controller = session.connections.get(session.controllerConnectionId);
    this.broadcast(session, {
      type: "presence",
      participants: participants(session),
      controller: terminalController(controller),
    });
  }

  broadcastLayout(session) {
    const controller = session.connections.get(session.controllerConnectionId);
    this.broadcast(session, {
      type: "layout",
      cols: session.cols,
      rows: session.rows,
      controller: terminalController(controller),
    });
  }
}

export function attachTerminalWebSocket(server, { manager, publicOrigin, heartbeatMs = HEARTBEAT_MS }) {
  const socketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_INPUT_BYTES,
    handleProtocols(protocols) {
      return protocols.has(TERMINAL_SOCKET_PROTOCOL) ? TERMINAL_SOCKET_PROTOCOL : false;
    },
  });
  const alive = new WeakMap();

  const onUpgrade = (request, socket, head) => {
    const url = safeUrl(request.url, publicOrigin);
    if (url?.pathname !== TERMINAL_SOCKET_PATH) return;
    const actor = terminalActor(request.headers);
    if (!actor || request.headers.origin !== publicOrigin) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    const protocols = parseProtocols(request.headers["sec-websocket-protocol"]);
    const ticketProtocol = protocols.find((protocol) => protocol.startsWith("ticket."));
    if (!protocols.includes(TERMINAL_SOCKET_PROTOCOL) || !ticketProtocol) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    const consumed = manager.consumeTicket(actor.id, ticketProtocol.slice("ticket.".length));
    if (!consumed) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    socketServer.handleUpgrade(request, socket, head, (websocket) => {
      socketServer.emit("connection", websocket, request, consumed.ticket.actor, consumed.session, consumed.ticket.afterSequence);
    });
  };
  server.on("upgrade", onUpgrade);

  socketServer.on("connection", (socket, _request, actor, session, afterSequence) => {
    alive.set(socket, true);
    socket.on("pong", () => alive.set(socket, true));
    const connection = manager.attach(session, actor, socket);
    const replay = manager.replay(session, afterSequence);
    sendSocket(socket, {
      type: "ready",
      mode: replay.mode,
      connectionId: connection.id,
      viewer: { id: actor.id, label: actor.label },
      session: manager.snapshot(actor, session),
    });
    if (replay.mode === "replay") {
      sendSocket(socket, { type: "replay", sequence: replay.sequence, data: replay.data });
    } else {
      for (const chunk of replay.chunks) {
        sendSocket(socket, { type: "output", sequence: chunk.sequence, data: chunk.data });
      }
    }

    socket.on("message", (raw, isBinary) => {
      if (isBinary) {
        socket.close(1008, "Binary terminal messages are not supported");
        return;
      }
      let message;
      try {
        message = JSON.parse(raw.toString("utf8"));
      } catch {
        socket.close(1008, "Invalid terminal message");
        return;
      }
      if (message?.type === "input") manager.input(session, connection, message.data);
      else if (message?.type === "resize") manager.resize(session, connection, message.cols, message.rows);
      else if (message?.type === "claim-control") manager.claimControl(session, connection);
      else if (message?.type === "reaction") manager.react(session, connection, message.emoji);
      else if (message?.type === "detach") socket.close(1000, "Terminal detached");
    });
    const detach = () => manager.detach(session, connection);
    socket.once("close", detach);
    socket.once("error", detach);
  });

  const heartbeat = setInterval(() => {
    for (const socket of socketServer.clients) {
      if (alive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, heartbeatMs);
  heartbeat.unref?.();

  return {
    close() {
      clearInterval(heartbeat);
      server.off("upgrade", onUpgrade);
      for (const socket of socketServer.clients) socket.close(1001, "Workspace server stopping");
      socketServer.close();
    },
  };
}

export function terminalActor(headers) {
  const id = singleHeader(headers["x-forwarded-user"]);
  if (!id?.trim()) return null;
  const email = singleHeader(headers["x-neural-labs-email"]);
  const role = singleHeader(headers["x-neural-labs-role"]) === "admin" ? "admin" : "user";
  return { id: id.trim(), label: actorLabel(email, id), role };
}

function terminalEnvironment(shell, workspaceRoot, { actor, scope, terminalId }) {
  const historyScope = scope === "team"
    ? `team-${terminalId}`
    : `personal-${createHash("sha256").update(actor.id).digest("hex").slice(0, 20)}`;
  const env = {
    HOME: os.homedir(),
    USER: process.env.USER || "node",
    LOGNAME: process.env.LOGNAME || process.env.USER || "node",
    SHELL: shell,
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: process.env.LANG || "C.UTF-8",
    HISTFILE: path.join(os.homedir(), ".local", "state", "neural-labs", "terminal-history", historyScope),
    OPENCLAW_WORKSPACE_DIR: workspaceRoot,
  };
  for (const name of ["CODEX_HOME", "OPENCLAW_HOME", "OPENCLAW_STATE_DIR", "OPENCLAW_CONFIG_PATH", "NEURAL_LABS_OPENCLAW_VERSION", "NEURAL_LABS_CODEX_VERSION"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("LC_") && value) env[name] = value;
  }
  return env;
}

function participants(session) {
  const values = new Map();
  for (const connection of session.connections.values()) {
    const current = values.get(connection.actor.id);
    values.set(connection.actor.id, {
      id: connection.actor.id,
      label: connection.actor.label,
      connections: (current?.connections ?? 0) + 1,
    });
  }
  return [...values.values()];
}

function terminalController(connection) {
  return connection ? {
    id: connection.actor.id,
    label: connection.actor.label,
    connectionId: connection.id,
  } : null;
}

function shellArguments(shell) {
  return path.basename(shell) === "zsh" ? ["-l"] : ["--login"];
}

function normalizeTitle(value, fallback) {
  const normalized = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 60);
  return normalized || fallback;
}

function normalizeSize(cols, rows) {
  return {
    cols: clampInteger(cols, 20, 320, 100),
    rows: clampInteger(rows, 6, 120, 30),
  };
}

function normalizeSequence(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function parseProtocols(value) {
  return String(value ?? "").split(",").map((protocol) => protocol.trim()).filter(Boolean);
}

function safeUrl(value, origin) {
  try {
    return new URL(String(value ?? "/"), origin);
  } catch {
    return null;
  }
}

function singleHeader(value) {
  return Array.isArray(value) ? value[0] : typeof value === "string" ? value : undefined;
}

function actorLabel(email, fallback) {
  const local = String(email ?? "").split("@")[0]?.trim();
  return (local || String(fallback)).slice(0, 80);
}

function sendSocket(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function rejectUpgrade(socket, status, reason) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
