const { randomUUID } = require("node:crypto");
const { spawn, execFile: nodeExecFile } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const execFile = promisify(nodeExecFile);

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
const DEFAULT_ACTIVITY_DIR = path.join(
  process.env.HOME || process.cwd(),
  ".local",
  "share",
  "neural-labs",
  "activity"
);

const DEFAULT_LOCAL_DATA_ROOT = path.join(
  process.env.HOME || process.cwd(),
  ".local",
  "share",
  "neural-labs"
);
const WORKSPACE_BACKEND = "docker";
const DATA_ROOT_BASE =
  process.env.NEURAL_LABS_DATA_DIR?.trim() || DEFAULT_LOCAL_DATA_ROOT;
const DOCKER_IMAGE = process.env.NEURAL_LABS_WORKSPACE_IMAGE?.trim() || "ubuntu:24.04";
const DOCKER_CONTAINER_PREFIX =
  process.env.NEURAL_LABS_CONTAINER_PREFIX?.trim() || "neural-labs-user";
const DOCKER_VOLUME_PREFIX =
  process.env.NEURAL_LABS_VOLUME_PREFIX?.trim() || "neural-labs-user";
const DOCKER_WORKSPACE_PATH =
  process.env.NEURAL_LABS_WORKSPACE_PATH?.trim() || "/home/neural-labs";
const USER_ID_SAFE_PATTERN = /[^a-z0-9_.-]/g;
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

function toSafeId(userId) {
  const safe = userId.toLowerCase().replace(USER_ID_SAFE_PATTERN, "-");
  return safe || "default";
}

async function runDocker(args) {
  const { stdout } = await execFile("docker", args, {
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

function getActivityDirectory() {
  return process.env.NEURAL_LABS_ACTIVITY_DIR?.trim() || DEFAULT_ACTIVITY_DIR;
}

function getActivityFilePath(userId) {
  const safeUserId = toSafeId(userId);
  return path.join(getActivityDirectory(), `${safeUserId}.json`);
}

function markWorkspaceActivity(userId, at = new Date()) {
  const timestamp = at.toISOString();
  const activityDirectory = getActivityDirectory();
  if (!existsSync(activityDirectory)) {
    mkdirSync(activityDirectory, { recursive: true });
  }
  const activityFilePath = getActivityFilePath(userId);
  writeFileSync(
    activityFilePath,
    JSON.stringify({ userId, lastActivityAt: timestamp }, null, 2),
    "utf-8"
  );
}

function markWorkspaceActivitySafe(userId, at = new Date()) {
  try {
    markWorkspaceActivity(userId, at);
  } catch (error) {
    console.warn(`[terminal/activity] Unable to persist activity for user ${userId}`, error);
  }
}

function parseTimestampMs(timestamp) {
  if (typeof timestamp !== "string" || !timestamp) {
    return null;
  }
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function getLastWorkspaceActivityMs(userId) {
  try {
    const activityFilePath = getActivityFilePath(userId);
    if (!existsSync(activityFilePath)) {
      return null;
    }
    const raw = readFileSync(activityFilePath, "utf-8");
    const parsed = JSON.parse(raw);
    return parseTimestampMs(parsed?.lastActivityAt);
  } catch {
    return null;
  }
}

async function ensureDockerVolume(volumeName) {
  try {
    await runDocker(["volume", "inspect", volumeName]);
  } catch {
    await runDocker(["volume", "create", volumeName]);
  }
}

async function ensureDockerContainer(containerName, volumeName, userId) {
  const createContainer = async () => {
    await runDocker([
      "run",
      "-d",
      "--name",
      containerName,
      "--hostname",
      containerName,
      "--label",
      "neural-labs.managed=true",
      "--label",
      `neural-labs.volume=${volumeName}`,
      "--label",
      `neural-labs.user-id=${userId}`,
      "-v",
      `${volumeName}:${DOCKER_WORKSPACE_PATH}`,
      "-w",
      DOCKER_WORKSPACE_PATH,
      "-e",
      `HOME=${DOCKER_WORKSPACE_PATH}`,
      DOCKER_IMAGE,
      "tail",
      "-f",
      "/dev/null",
    ]);
  };

  const recreateContainer = async () => {
    try {
      await runDocker(["rm", "-f", containerName]);
    } catch {
      // Ignore cleanup errors and attempt to create a fresh container.
    }
    await createContainer();
  };

  try {
    const running = await runDocker([
      "inspect",
      "--format",
      "{{ .State.Running }}",
      containerName,
    ]);

    const workingDir = await runDocker([
      "inspect",
      "--format",
      "{{ .Config.WorkingDir }}",
      containerName,
    ]);
    const mountedVolume = await runDocker([
      "inspect",
      "--format",
      `{{range .Mounts}}{{if eq .Destination "${DOCKER_WORKSPACE_PATH}"}}{{.Name}}{{end}}{{end}}`,
      containerName,
    ]);
    const labeledUserId = await runDocker([
      "inspect",
      "--format",
      '{{ index .Config.Labels "neural-labs.user-id" }}',
      containerName,
    ]);
    const shouldRecreate =
      workingDir !== DOCKER_WORKSPACE_PATH ||
      mountedVolume !== volumeName ||
      labeledUserId !== userId;

    if (shouldRecreate) {
      await recreateContainer();
      return;
    }

    if (running !== "true") {
      await runDocker(["start", containerName]);
    }
    return;
  } catch {
    // If inspect fails, create the container.
  }

  await createContainer();
}

async function getWorkspaceSession(userId) {
  if (WORKSPACE_BACKEND !== "docker") {
    throw new Error("Neural Labs terminal is configured for docker backend only.");
  }

  const safeId = toSafeId(userId);
  const volumeName = `${DOCKER_VOLUME_PREFIX}-${safeId}`;
  const containerName = `${DOCKER_CONTAINER_PREFIX}-${safeId}`;

  await ensureDockerVolume(volumeName);
  await ensureDockerContainer(containerName, volumeName, userId);

  const mountpoint = await runDocker([
    "volume",
    "inspect",
    "--format",
    "{{ .Mountpoint }}",
    volumeName,
  ]);
  const workspaceRoot = path.resolve(mountpoint);
  const dataRoot = path.join(workspaceRoot, ".neural-labs");
  return {
    userId,
    backend: "docker",
    workspaceRoot,
    dataRoot,
    stateFilePath: path.join(dataRoot, "state.json"),
    containerName,
    volumeName,
    workspacePathInContainer: DOCKER_WORKSPACE_PATH,
  };
}

async function ensureWorkspaceScaffold(userId) {
  const workspace = await getWorkspaceSession(userId);
  await mkdir(workspace.workspaceRoot, { recursive: true });
  await mkdir(workspace.dataRoot, { recursive: true });

  const readmePath = path.join(workspace.workspaceRoot, "README.md");
  if (!existsSync(readmePath)) {
    await writeFile(
      readmePath,
      "# Neural Labs Workspace\n\nThis directory stores files created inside the Neural Labs desktop.\n",
      "utf-8"
    );
  }

  return workspace;
}

class TerminalSession {
  constructor(process) {
    this.id = randomUUID();
    this.title = "Shell";
    this.createdAt = new Date().toISOString();
    this.lastActivityAt = this.createdAt;
    this.alive = true;
    this.backlog = [];
    this.listeners = new Set();
    this.process = process;
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

  buildProcess(workspace) {
    if (workspace.backend !== "docker") {
      throw new Error("Neural Labs terminal is configured for docker backend only.");
    }

    const shell = process.env.NEURAL_LABS_WORKSPACE_SHELL || "bash";
    const interactiveShellCommand = `${shell} --noprofile --norc -i`;
    if (!workspace.containerName || !workspace.workspacePathInContainer) {
      throw new Error("Workspace container is not available for this user.");
    }

    return spawn(
      "docker",
      [
        "exec",
        "-i",
        "-w",
        workspace.workspacePathInContainer,
        "-e",
        `HOME=${workspace.workspacePathInContainer}`,
        "-e",
        "PS1=neural-labs$ ",
        "-e",
        "TERM=xterm-256color",
        workspace.containerName,
        "script",
        "-qec",
        interactiveShellCommand,
        "/dev/null",
      ],
      {
        stdio: "pipe",
        env: process.env,
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

  async createSession(userId) {
    markWorkspaceActivitySafe(userId);
    const workspace = await ensureWorkspaceScaffold(userId);
    const child = this.buildProcess(workspace);

    const session = new TerminalSession(child);
    session.pushChunk({
      type: "output",
      text: NEURAL_LABS_BANNER_TEXT,
      terminalId: session.id,
    });
    const handleOutput = (buffer, type = "output") => {
      session.pushChunk({
        type,
        text: buffer.toString("utf-8"),
        terminalId: session.id,
      });
    };

    child.stdout.on("data", (buffer) => handleOutput(buffer));
    child.stderr.on("data", (buffer) => handleOutput(buffer));
    child.on("exit", (code) => {
      session.alive = false;
      handleOutput(Buffer.from(`\n[process exited with code ${code ?? 0}]\n`), "exit");
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
    };
  }

  writeInput(userId, sessionId, data) {
    const resolved = this.resolveOwnedSession(userId, sessionId);
    if (!resolved) {
      throw new Error("Terminal session not found");
    }
    const { session } = resolved;
    session.lastActivityAt = new Date().toISOString();
    markWorkspaceActivitySafe(userId);
    session.process.stdin.write(data);
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
