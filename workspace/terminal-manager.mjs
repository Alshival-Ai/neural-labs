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
const MAX_VOICE_CONNECTIONS_PER_SESSION = 8;
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
    turnCredentialProvider = async () => [],
    teamChannelAuthorizer = async () => null,
  } = {}) {
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    this.workspaceRoot = workspaceRoot;
    this.shell = shell;
    this.now = now;
    this.spawnPty = spawnPty;
    this.turnCredentialProvider = turnCredentialProvider;
    this.teamChannelAuthorizer = teamChannelAuthorizer;
    this.sessions = new Map();
    this.tickets = new Map();
    this.cleanupTimer = setInterval(() => this.cleanupTickets(), 30_000);
    this.cleanupTimer.unref?.();
  }

  async list(actor) {
    const sessions = [...this.sessions.values()];
    const access = await Promise.all(sessions.map((session) => this.canAccess(actor, session)));
    return sessions
      .filter((_session, index) => access[index])
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((session) => this.snapshot(actor, session));
  }

  async create(actor, input = {}) {
    const scope = input.scope === "team" ? "team" : "personal";
    const channelId = scope === "team" ? normalizeChannelId(input.channelId) : null;
    let teamChannel = null;
    if (channelId) {
      teamChannel = await this.authorizeTeamChannel(actor, channelId);
      if (!teamChannel) throw new TerminalError(404, "team_channel_not_found", "Team Chat channel not found");
    }
    if (this.sessions.size >= MAX_TOTAL_SESSIONS) {
      throw new TerminalError(429, "terminal_limit_reached", "The workspace terminal limit has been reached");
    }
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
    const channelIndex = channelId
      ? [...this.sessions.values()].filter((session) => session.channelId === channelId).length + 1
      : defaultIndex;
    const title = teamChannel
      ? normalizeTitle(`#${teamChannel.name} · terminal ${channelIndex}`, "Team Chat terminal")
      : normalizeTitle(input.title, scope === "team" ? `Team shell ${defaultIndex}` : `shell ${defaultIndex}`);
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
      channelId,
      channelName: teamChannel?.name ?? null,
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
      layoutConnectionId: null,
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

  async get(actor, terminalId) {
    const session = this.sessions.get(String(terminalId ?? ""));
    return session && await this.canAccess(actor, session) ? session : null;
  }

  async issueTicket(actor, terminalId, afterSequence) {
    const session = await this.get(actor, terminalId);
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

  async consumeTicket(actorId, token) {
    const normalized = String(token ?? "");
    const ticket = this.tickets.get(normalized);
    this.tickets.delete(normalized);
    if (!ticket || ticket.expiresAt <= this.now() || ticket.actor.id !== actorId) return null;
    const session = this.sessions.get(ticket.terminalId);
    if (!session || !(await this.canAccess(ticket.actor, session))) return null;
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
      voiceJoined: false,
      voiceJoining: false,
      voiceMode: "muted",
    };
    session.connections.set(connection.id, connection);
    if (session.scope === "team" && !session.layoutConnectionId) {
      session.layoutConnectionId = connection.id;
    }
    this.broadcastPresence(session);
    return connection;
  }

  detach(session, connection) {
    const voiceChanged = connection.voiceJoined;
    if (!session.connections.delete(connection.id)) return;
    if (session.layoutConnectionId === connection.id) {
      session.layoutConnectionId = session.connections.keys().next().value ?? null;
    }
    this.broadcastPresence(session);
    if (voiceChanged) this.broadcastVoicePresence(session);
  }

  input(session, connection, data) {
    if (session.status !== "running") return;
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
    if (session.scope === "team" && session.layoutConnectionId !== connection.id) return false;
    const size = normalizeSize(cols, rows);
    if (size.cols === session.cols && size.rows === session.rows) return true;
    session.cols = size.cols;
    session.rows = size.rows;
    session.process.resize(size.cols, size.rows);
    this.broadcastLayout(session);
    return true;
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

  async joinVoice(session, connection, mode) {
    if (session.scope !== "team" || connection.voiceJoined || connection.voiceJoining) return;
    const occupied = [...session.connections.values()].filter((candidate) => candidate.voiceJoined || candidate.voiceJoining).length;
    if (occupied >= MAX_VOICE_CONNECTIONS_PER_SESSION) {
      sendSocket(connection.socket, {
        type: "voice-error",
        code: "voice_room_full",
        message: "This voice chat already has the maximum of eight connected devices",
      });
      return;
    }
    connection.voiceJoining = true;
    let iceServers;
    try {
      iceServers = await this.turnCredentialProvider(connection.actor);
    } catch {
      connection.voiceJoining = false;
      sendSocket(connection.socket, {
        type: "voice-error",
        code: "voice_relay_unavailable",
        message: "Voice relay credentials are temporarily unavailable",
      });
      return;
    }
    connection.voiceJoining = false;
    if (!session.connections.has(connection.id)) return;
    sendSocket(connection.socket, { type: "voice-config", iceServers });
    connection.voiceJoined = true;
    connection.voiceMode = normalizeVoiceMode(mode);
    this.broadcastVoicePresence(session);
  }

  leaveVoice(session, connection) {
    if (!connection.voiceJoined) return;
    connection.voiceJoined = false;
    connection.voiceMode = "muted";
    this.broadcastVoicePresence(session);
  }

  setVoiceMode(session, connection, mode) {
    if (session.scope !== "team" || !connection.voiceJoined) return;
    const nextMode = normalizeVoiceMode(mode);
    if (nextMode === connection.voiceMode) return;
    connection.voiceMode = nextMode;
    this.broadcastVoicePresence(session);
  }

  signalVoice(session, connection, targetConnectionId, value) {
    if (session.scope !== "team" || !connection.voiceJoined) return;
    const target = session.connections.get(String(targetConnectionId ?? ""));
    const signal = normalizeVoiceSignal(value);
    if (!target?.voiceJoined || target.id === connection.id || !signal) return;
    sendSocket(target.socket, {
      type: "voice-signal",
      fromConnectionId: connection.id,
      actor: { id: connection.actor.id, label: connection.actor.label },
      signal,
    });
  }

  async close(actor, terminalId) {
    const session = await this.get(actor, terminalId);
    if (!session) return false;
    if (session.scope === "team" && actor.id !== session.ownerId && actor.role !== "admin") {
      throw new TerminalError(403, "terminal_forbidden", "Only the creator or an administrator can end this Team Terminal");
    }
    this.destroy(session);
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
    const layoutLeader = session.connections.get(session.layoutConnectionId);
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
      voiceParticipants: voiceParticipants(session),
      layoutLeader: terminalLayoutLeader(layoutLeader),
      ...(session.channelId ? { teamChannel: { id: session.channelId, name: session.channelName } } : {}),
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
      this.destroy(session);
    }
    this.tickets.clear();
  }

  async canAccess(actor, session) {
    if (session.scope === "personal") return session.ownerId === actor.id;
    if (!session.channelId) return true;
    const channel = await this.authorizeTeamChannel(actor, session.channelId);
    if (channel) session.channelName = channel.name;
    return Boolean(channel);
  }

  async authorizeTeamChannel(actor, channelId) {
    try {
      const access = await this.teamChannelAuthorizer(actor, channelId);
      return access?.allowed === true && access.channel?.id === channelId && typeof access.channel.name === "string"
        ? access.channel
        : null;
    } catch {
      return null;
    }
  }

  async revalidateConnections() {
    for (const session of this.sessions.values()) {
      if (!session.channelId || session.connections.size === 0) continue;
      const actors = new Map([...session.connections.values()].map((connection) => [connection.actor.id, connection.actor]));
      const allowed = new Map();
      await Promise.all([...actors].map(async ([actorId, actor]) => {
        allowed.set(actorId, await this.canAccess(actor, session));
      }));
      for (const connection of session.connections.values()) {
        if (allowed.get(connection.actor.id) !== false) continue;
        connection.socket.close(1008, "Team Chat access revoked");
      }
    }
  }

  destroy(session) {
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
    const layoutLeader = session.connections.get(session.layoutConnectionId);
    this.broadcast(session, {
      type: "presence",
      participants: participants(session),
      voiceParticipants: voiceParticipants(session),
      layoutLeader: terminalLayoutLeader(layoutLeader),
    });
  }

  broadcastVoicePresence(session) {
    this.broadcast(session, {
      type: "voice-presence",
      participants: voiceParticipants(session),
    });
  }

  broadcastLayout(session) {
    const layoutLeader = session.connections.get(session.layoutConnectionId);
    this.broadcast(session, {
      type: "layout",
      cols: session.cols,
      rows: session.rows,
      layoutLeader: terminalLayoutLeader(layoutLeader),
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
    void (async () => {
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
      const consumed = await manager.consumeTicket(actor.id, ticketProtocol.slice("ticket.".length));
      if (!consumed) {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      socketServer.handleUpgrade(request, socket, head, (websocket) => {
        socketServer.emit("connection", websocket, request, consumed.ticket.actor, consumed.session, consumed.ticket.afterSequence);
      });
    })().catch(() => rejectUpgrade(socket, 403, "Forbidden"));
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
      else if (message?.type === "reaction") manager.react(session, connection, message.emoji);
      else if (message?.type === "voice-join") void manager.joinVoice(session, connection, message.mode);
      else if (message?.type === "voice-leave") manager.leaveVoice(session, connection);
      else if (message?.type === "voice-mode") manager.setVoiceMode(session, connection, message.mode);
      else if (message?.type === "voice-signal") manager.signalVoice(session, connection, message.targetConnectionId, message.signal);
      else if (message?.type === "detach") socket.close(1000, "Terminal detached");
    });
    const detach = () => manager.detach(session, connection);
    socket.once("close", detach);
    socket.once("error", detach);
  });

  const heartbeat = setInterval(() => {
    void manager.revalidateConnections();
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

function voiceParticipants(session) {
  return [...session.connections.values()].flatMap((connection) => connection.voiceJoined ? [{
    connectionId: connection.id,
    id: connection.actor.id,
    label: connection.actor.label,
    mode: connection.voiceMode,
  }] : []);
}

function terminalLayoutLeader(connection) {
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

function normalizeChannelId(value) {
  if (value === undefined || value === null || value === "") return null;
  const channelId = String(value).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(channelId)) {
    throw new TerminalError(422, "invalid_team_channel", "A valid Team Chat channel is required");
  }
  return channelId;
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

function normalizeVoiceMode(value) {
  return value === "open-mic" || value === "push-to-talk" ? value : "muted";
}

function normalizeVoiceSignal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.description && typeof value.description === "object" && !Array.isArray(value.description)) {
    const type = value.description.type;
    const sdp = value.description.sdp;
    if (!["offer", "answer"].includes(type) || typeof sdp !== "string" || !sdp || sdp.length > 32 * 1024) return null;
    return { description: { type, sdp } };
  }
  if (value.candidate && typeof value.candidate === "object" && !Array.isArray(value.candidate)) {
    const candidate = value.candidate.candidate;
    const sdpMid = value.candidate.sdpMid;
    const sdpMLineIndex = value.candidate.sdpMLineIndex;
    const usernameFragment = value.candidate.usernameFragment;
    if (typeof candidate !== "string" || candidate.length > 4096) return null;
    if (sdpMid !== null && sdpMid !== undefined && (typeof sdpMid !== "string" || sdpMid.length > 256)) return null;
    if (sdpMLineIndex !== null && sdpMLineIndex !== undefined && (!Number.isInteger(sdpMLineIndex) || sdpMLineIndex < 0 || sdpMLineIndex > 64)) return null;
    if (usernameFragment !== null && usernameFragment !== undefined && (typeof usernameFragment !== "string" || usernameFragment.length > 256)) return null;
    return { candidate: { candidate, sdpMid: sdpMid ?? null, sdpMLineIndex: sdpMLineIndex ?? null, usernameFragment: usernameFragment ?? null } };
  }
  return null;
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
