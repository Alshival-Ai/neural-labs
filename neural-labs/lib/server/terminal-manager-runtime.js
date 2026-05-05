const { randomUUID } = require("node:crypto");
const path = require("node:path");
const pty = require("@homebridge/node-pty-prebuilt-multiarch");
const {
  DOCKER_CONTAINER_PREFIX,
  ensureWorkspaceScaffold,
  getLastWorkspaceActivityMs,
  markWorkspaceActivitySafe,
  parseTimestampMs,
  runDocker,
} = require("./workspace-runtime.js");

const WS_TICKET_TTL_MS = Number.isFinite(
  Number.parseInt(process.env.NEURAL_LABS_WS_TICKET_TTL_MS || "", 10)
)
  ? Math.max(10_000, Number.parseInt(process.env.NEURAL_LABS_WS_TICKET_TTL_MS || "", 10))
  : 90_000;
const WS_AUTH_TICKET_TTL_MS = Number.isFinite(
  Number.parseInt(process.env.NEURAL_LABS_WS_AUTH_TICKET_TTL_MS || "", 10)
)
  ? Math.max(10_000, Number.parseInt(process.env.NEURAL_LABS_WS_AUTH_TICKET_TTL_MS || "", 10))
  : 60_000;
const CONTAINER_IDLE_TIMEOUT_MS = Number.isFinite(
  Number.parseInt(process.env.NEURAL_LABS_CONTAINER_IDLE_TIMEOUT_MS || "", 10)
)
  ? Math.max(60_000, Number.parseInt(process.env.NEURAL_LABS_CONTAINER_IDLE_TIMEOUT_MS || "", 10))
  : 60 * 60 * 1000;
const CONTAINER_IDLE_SWEEP_INTERVAL_MS = Number.isFinite(
  Number.parseInt(process.env.NEURAL_LABS_CONTAINER_IDLE_SWEEP_INTERVAL_MS || "", 10)
)
  ? Math.max(
      30_000,
      Number.parseInt(process.env.NEURAL_LABS_CONTAINER_IDLE_SWEEP_INTERVAL_MS || "", 10)
    )
  : 5 * 60 * 1000;
const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 32;
const NEURAL_LABS_BANNER_TEXT =
  "\r\n" +
  " ███╗   ██╗███████╗██╗   ██╗██████╗  █████╗ ██╗         ██╗      █████╗ ██████╗ ███████╗\r\n" +
  " ████╗  ██║██╔════╝██║   ██║██╔══██╗██╔══██╗██║         ██║     ██╔══██╗██╔══██╗██╔════╝\r\n" +
  " ██╔██╗ ██║█████╗  ██║   ██║██████╔╝███████║██║         ██║     ███████║██████╔╝███████╗\r\n" +
  " ██║╚██╗██║██╔══╝  ██║   ██║██╔══██╗██╔══██║██║         ██║     ██╔══██║██╔══██╗╚════██║\r\n" +
  " ██║ ╚████║███████╗╚██████╔╝██║  ██║██║  ██║███████╗    ███████╗██║  ██║██████╔╝███████║\r\n" +
  " ╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝    ╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝\r\n" +
  "\r\n" +
  "             >> environment initialized <<\r\n" +
  "\r\n";

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function getShellBaseName(shell) {
  return path.basename(shell.trim().split(/\s+/)[0] || shell);
}

function normalizeTerminalSize(cols, rows) {
  const nextCols = Number.isFinite(cols)
    ? Math.max(20, Math.min(500, Math.floor(cols)))
    : DEFAULT_TERMINAL_COLS;
  const nextRows = Number.isFinite(rows)
    ? Math.max(6, Math.min(200, Math.floor(rows)))
    : DEFAULT_TERMINAL_ROWS;
  return { cols: nextCols, rows: nextRows };
}

class TerminalSession {
  constructor(process, size) {
    this.id = randomUUID();
    this.title = "Shell";
    this.createdAt = new Date().toISOString();
    this.lastActivityAt = this.createdAt;
    this.alive = true;
    this.backlog = [];
    this.listeners = new Set();
    this.process = process;
    this.cols = size.cols;
    this.rows = size.rows;
  }

  pushChunk(chunk) {
    this.lastActivityAt = new Date().toISOString();
    this.backlog.push(chunk);
    if (this.backlog.length > 300) {
      this.backlog.splice(0, this.backlog.length - 300);
    }
    for (const listener of this.listeners) {
      listener(chunk);
    }
  }

  write(data) {
    this.lastActivityAt = new Date().toISOString();
    this.process.write(data);
  }

  resize(cols, rows) {
    const size = normalizeTerminalSize(cols, rows);
    this.cols = size.cols;
    this.rows = size.rows;
    if (!this.alive) {
      return;
    }
    this.process.resize(size.cols, size.rows);
  }
}

class TerminalManager {
  constructor() {
    this.sessionsByUser = new Map();
    this.wsTickets = new Map();
    this.wsAuthTickets = new Map();
    this.deadSessionTtlMs = Number.isFinite(
      Number.parseInt(process.env.NEURAL_LABS_DEAD_SESSION_TTL_MS || "", 10)
    )
      ? Math.max(15_000, Number.parseInt(process.env.NEURAL_LABS_DEAD_SESSION_TTL_MS || "", 10))
      : 5 * 60 * 1000;
    this.cleanupTimers = new Map();
    this.containerIdleTimeoutMs = CONTAINER_IDLE_TIMEOUT_MS;
    this.containerIdleSweepIntervalMs = CONTAINER_IDLE_SWEEP_INTERVAL_MS;
    this.idleSweepInFlight = false;
    if (this.containerIdleTimeoutMs > 0 && this.containerIdleSweepIntervalMs > 0) {
      this.idleSweepTimer = setInterval(() => {
        void this.sweepIdleContainers();
      }, this.containerIdleSweepIntervalMs);
      if (typeof this.idleSweepTimer.unref === "function") {
        this.idleSweepTimer.unref();
      }
      void this.sweepIdleContainers();
    }
  }

  getCleanupTimerKey(userId, sessionId) {
    return `${userId}:${sessionId}`;
  }

  purgeExpiredWsTickets(now = Date.now()) {
    for (const [token, ticket] of this.wsTickets.entries()) {
      if (ticket.expiresAt <= now) {
        this.wsTickets.delete(token);
      }
    }
  }

  purgeExpiredWsAuthTickets(now = Date.now()) {
    for (const [token, ticket] of this.wsAuthTickets.entries()) {
      if (ticket.expiresAt <= now) {
        this.wsAuthTickets.delete(token);
      }
    }
  }

  clearCleanupTimer(userId, sessionId) {
    const timerKey = this.getCleanupTimerKey(userId, sessionId);
    const timer = this.cleanupTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(timerKey);
    }
  }

  scheduleCleanup(userId, sessionId) {
    this.clearCleanupTimer(userId, sessionId);
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(this.getCleanupTimerKey(userId, sessionId));
      this.cleanupSession(userId, sessionId);
    }, this.deadSessionTtlMs);
    this.cleanupTimers.set(this.getCleanupTimerKey(userId, sessionId), timer);
  }

  buildProcess(workspace, size) {
    if (workspace.backend !== "docker") {
      throw new Error("Neural Labs terminal is configured for docker backend only.");
    }

    if (!workspace.containerName || !workspace.workspacePathInContainer) {
      throw new Error("Workspace container is not available for this user.");
    }

    const shell = process.env.NEURAL_LABS_WORKSPACE_SHELL || "bash";
    const configuredShellArgs = process.env.NEURAL_LABS_WORKSPACE_SHELL_ARGS?.trim();
    const shellRcPath = `${workspace.workspacePathInContainer}/.neural-labs/shellrc`;
    const shellArgs =
      configuredShellArgs ||
      (getShellBaseName(shell) === "bash"
        ? `--rcfile ${shellQuote(shellRcPath)} -i`
        : "-i");
    const interactiveShellCommand = `${shellQuote(shell)} ${shellArgs}`.trim();

    return pty.spawn(
      "docker",
      [
        "exec",
        "-it",
        "-w",
        workspace.workspacePathInContainer,
        "-e",
        `HOME=${workspace.workspacePathInContainer}`,
        "-e",
        `COLUMNS=${size.cols}`,
        "-e",
        `LINES=${size.rows}`,
        "-e",
        "PS1=neural-labs$ ",
        "-e",
        "TERM=xterm-256color",
        workspace.containerName,
        "sh",
        "-lc",
        `exec ${interactiveShellCommand}`,
      ],
      {
        env: process.env,
        name: "xterm-256color",
        cols: size.cols,
        rows: size.rows,
      }
    );
  }

  getUserSessions(userId) {
    let sessions = this.sessionsByUser.get(userId);
    if (!sessions) {
      sessions = new Map();
      this.sessionsByUser.set(userId, sessions);
    }
    return sessions;
  }

  cleanupSession(userId, sessionId) {
    this.clearCleanupTimer(userId, sessionId);
    for (const [token, ticket] of this.wsTickets.entries()) {
      if (ticket.userId === userId && ticket.sessionId === sessionId) {
        this.wsTickets.delete(token);
      }
    }

    const sessions = this.sessionsByUser.get(userId);
    if (!sessions) {
      return;
    }
    sessions.delete(sessionId);
    if (sessions.size === 0) {
      this.sessionsByUser.delete(userId);
    }
  }

  resolveOwnedSession(userId, sessionId) {
    const direct = this.sessionsByUser.get(userId)?.get(sessionId);
    if (direct) {
      return { ownerUserId: userId, session: direct };
    }
    return null;
  }

  getInMemoryLastActivityMs(userId) {
    const sessions = this.sessionsByUser.get(userId);
    if (!sessions || sessions.size === 0) {
      return null;
    }

    let latest = null;
    for (const session of sessions.values()) {
      const sessionLastActivityMs = parseTimestampMs(session.lastActivityAt);
      if (sessionLastActivityMs === null) {
        continue;
      }
      if (latest === null || sessionLastActivityMs > latest) {
        latest = sessionLastActivityMs;
      }
    }
    return latest;
  }

  async getContainerUserId(containerName) {
    try {
      const labeledUserId = await runDocker([
        "inspect",
        "--format",
        '{{ index .Config.Labels "neural-labs.user-id" }}',
        containerName,
      ]);
      if (labeledUserId) {
        return labeledUserId;
      }
    } catch {
      // Ignore inspect errors so one bad container doesn't break the sweep.
    }

    const prefix = `${DOCKER_CONTAINER_PREFIX}-`;
    if (containerName.startsWith(prefix)) {
      const fallbackUserId = containerName.slice(prefix.length);
      return fallbackUserId || null;
    }
    return null;
  }

  async sweepIdleContainers() {
    if (this.idleSweepInFlight || this.containerIdleTimeoutMs <= 0) {
      return;
    }
    this.idleSweepInFlight = true;
    const now = Date.now();

    try {
      let output = "";
      try {
        output = await runDocker([
          "ps",
          "--filter",
          "label=neural-labs.managed=true",
          "--format",
          "{{.Names}}",
        ]);
      } catch (error) {
        console.warn("[terminal/idle] Unable to list running containers", error);
        return;
      }

      if (!output) {
        return;
      }

      const managedContainers = output
        .split("\n")
        .map((entry) => entry.trim())
        .filter((entry) => Boolean(entry))
        .filter((entry) => entry.startsWith(`${DOCKER_CONTAINER_PREFIX}-`));

      for (const containerName of managedContainers) {
        const userId = await this.getContainerUserId(containerName);
        if (!userId) {
          continue;
        }

        let persistedActivityMs = null;
        try {
          persistedActivityMs = getLastWorkspaceActivityMs(userId);
        } catch (error) {
          console.warn(
            `[terminal/idle] Unable to load persisted activity for user ${userId}`,
            error
          );
        }
        const inMemoryActivityMs = this.getInMemoryLastActivityMs(userId);
        const latestActivityMs = Math.max(persistedActivityMs ?? 0, inMemoryActivityMs ?? 0);
        if (!latestActivityMs || now - latestActivityMs < this.containerIdleTimeoutMs) {
          continue;
        }

        try {
          await runDocker(["stop", "-t", "10", containerName]);
          console.log(
            `[terminal/idle] Stopped idle container ${containerName} after ${Math.round(
              (now - latestActivityMs) / 1000
            )}s of inactivity.`
          );
        } catch (error) {
          console.warn(
            `[terminal/idle] Failed to stop idle container ${containerName}`,
            error
          );
        }
      }
    } catch (error) {
      console.warn("[terminal/idle] Idle sweep failed", error);
    } finally {
      this.idleSweepInFlight = false;
    }
  }

  async createSession(userId, size = {}) {
    markWorkspaceActivitySafe(userId);
    const workspace = await ensureWorkspaceScaffold(userId);
    const initialSize = normalizeTerminalSize(size.cols, size.rows);
    const child = this.buildProcess(workspace, initialSize);

    const session = new TerminalSession(child, initialSize);
    session.pushChunk({
      type: "output",
      text: NEURAL_LABS_BANNER_TEXT,
      terminalId: session.id,
    });
    const handleOutput = (text, type = "output") => {
      session.pushChunk({
        type,
        text,
        terminalId: session.id,
      });
    };

    child.onData((data) => handleOutput(data));
    child.onExit((event) => {
      session.alive = false;
      handleOutput(`\n[process exited with code ${event.exitCode ?? 0}]\n`, "exit");
      this.scheduleCleanup(userId, session.id);
    });

    this.getUserSessions(userId).set(session.id, session);
    return session;
  }

  list(userId) {
    return [...this.getUserSessions(userId).values()].map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      alive: session.alive,
    }));
  }

  get(userId, sessionId) {
    return this.resolveOwnedSession(userId, sessionId)?.session ?? null;
  }

  getStatus(userId, sessionId) {
    const session = this.get(userId, sessionId);
    if (!session) {
      return null;
    }
    return {
      id: session.id,
      alive: session.alive,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      cols: session.cols,
      rows: session.rows,
      state: session.alive ? "running" : "exited",
    };
  }

  writeInput(userId, sessionId, data) {
    const resolved = this.resolveOwnedSession(userId, sessionId);
    if (!resolved) {
      throw new Error("Terminal session not found");
    }
    const { session } = resolved;
    markWorkspaceActivitySafe(userId);
    session.write(data);
  }

  resize(userId, sessionId, cols, rows) {
    const resolved = this.resolveOwnedSession(userId, sessionId);
    if (!resolved) {
      throw new Error("Terminal session not found");
    }
    const { session } = resolved;
    session.resize(cols, rows);
    markWorkspaceActivitySafe(userId);
  }

  subscribe(userId, sessionId, listener) {
    const resolved = this.resolveOwnedSession(userId, sessionId);
    if (!resolved) {
      throw new Error("Terminal session not found");
    }
    const { session } = resolved;
    for (const chunk of session.backlog) {
      listener(chunk);
    }
    session.listeners.add(listener);
    return () => {
      session.listeners.delete(listener);
    };
  }

  issueWsTicket(userId, sessionId) {
    this.purgeExpiredWsTickets();

    const session = this.getUserSessions(userId).get(sessionId);
    if (!session || !session.alive) {
      throw new Error("Terminal session not found");
    }

    const token = randomUUID();
    this.wsTickets.set(token, {
      userId,
      sessionId,
      expiresAt: Date.now() + WS_TICKET_TTL_MS,
    });
    markWorkspaceActivitySafe(userId);
    return token;
  }

  issueWsAuthTicket(userId) {
    this.purgeExpiredWsAuthTickets();
    const token = randomUUID();
    this.wsAuthTickets.set(token, {
      userId,
      expiresAt: Date.now() + WS_AUTH_TICKET_TTL_MS,
    });
    markWorkspaceActivitySafe(userId);
    return token;
  }

  consumeWsAuthTicket(token) {
    this.purgeExpiredWsAuthTickets();
    const ticket = this.wsAuthTickets.get(token);
    if (!ticket) {
      return null;
    }
    this.wsAuthTickets.delete(token);
    markWorkspaceActivitySafe(ticket.userId);
    return ticket.userId;
  }

  consumeWsTicket(userId, token) {
    this.purgeExpiredWsTickets();
    const ticket = this.wsTickets.get(token);
    if (!ticket) {
      return null;
    }
    this.wsTickets.delete(token);

    if (ticket.userId !== userId) {
      return null;
    }

    const session = this.getUserSessions(userId).get(ticket.sessionId);
    if (!session || !session.alive) {
      return null;
    }
    markWorkspaceActivitySafe(userId);
    return ticket.sessionId;
  }

  close(userId, sessionId) {
    const resolved = this.resolveOwnedSession(userId, sessionId);
    if (!resolved) {
      return;
    }
    const { ownerUserId, session } = resolved;
    session.process.kill();
    this.cleanupSession(ownerUserId, sessionId);
  }
}

function getNeuralLabsTerminalManagerSingleton() {
  if (!globalThis.__neuralLabsTerminalManagerRuntime) {
    globalThis.__neuralLabsTerminalManagerRuntime = new TerminalManager();
  }
  return globalThis.__neuralLabsTerminalManagerRuntime;
}

module.exports = {
  getTerminalManager: getNeuralLabsTerminalManagerSingleton,
};
