const { randomUUID } = require("node:crypto");
const { spawn, execFile: nodeExecFile } = require("node:child_process");
const { existsSync } = require("node:fs");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const execFile = promisify(nodeExecFile);

const WS_TICKET_TTL_MS = Number.isFinite(
  Number.parseInt(process.env.NEURAL_LABS_WS_TICKET_TTL_MS || "", 10)
)
  ? Math.max(10_000, Number.parseInt(process.env.NEURAL_LABS_WS_TICKET_TTL_MS || "", 10))
  : 90_000;

const DEFAULT_LOCAL_DATA_ROOT = path.join(
  process.env.HOME || process.cwd(),
  ".local",
  "share",
  "neural-labs"
);
const WORKSPACE_BACKEND =
  process.env.NEURAL_LABS_WORKSPACE_BACKEND === "local" ? "local" : "docker";
const DATA_ROOT_BASE =
  process.env.NEURAL_LABS_DATA_DIR?.trim() || DEFAULT_LOCAL_DATA_ROOT;
const DOCKER_IMAGE = process.env.NEURAL_LABS_WORKSPACE_IMAGE?.trim() || "ubuntu:24.04";
const DOCKER_CONTAINER_PREFIX =
  process.env.NEURAL_LABS_CONTAINER_PREFIX?.trim() || "neural-labs-user";
const DOCKER_VOLUME_PREFIX =
  process.env.NEURAL_LABS_VOLUME_PREFIX?.trim() || "neural-labs-user";
const DOCKER_WORKSPACE_PATH =
  process.env.NEURAL_LABS_WORKSPACE_PATH?.trim() || "/workspace";
const USER_ID_SAFE_PATTERN = /[^a-z0-9_.-]/g;

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

async function ensureDockerVolume(volumeName) {
  try {
    await runDocker(["volume", "inspect", volumeName]);
  } catch {
    await runDocker(["volume", "create", volumeName]);
  }
}

async function ensureDockerContainer(containerName, volumeName) {
  try {
    const running = await runDocker([
      "inspect",
      "--format",
      "{{ .State.Running }}",
      containerName,
    ]);
    if (running !== "true") {
      await runDocker(["start", containerName]);
    }
    return;
  } catch {
    // If inspect fails, create the container.
  }

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
    "-v",
    `${volumeName}:${DOCKER_WORKSPACE_PATH}`,
    "-w",
    DOCKER_WORKSPACE_PATH,
    DOCKER_IMAGE,
    "tail",
    "-f",
    "/dev/null",
  ]);
}

async function getWorkspaceSession(userId) {
  if (WORKSPACE_BACKEND === "local") {
    const userRoot = path.join(DATA_ROOT_BASE, "users", toSafeId(userId));
    const workspaceRoot = path.join(userRoot, "workspace");
    const dataRoot = path.join(userRoot, ".neural-labs");
    return {
      userId,
      backend: "local",
      workspaceRoot,
      dataRoot,
      stateFilePath: path.join(dataRoot, "state.json"),
      containerName: null,
      volumeName: null,
      workspacePathInContainer: null,
    };
  }

  const safeId = toSafeId(userId);
  const volumeName = `${DOCKER_VOLUME_PREFIX}-${safeId}`;
  const containerName = `${DOCKER_CONTAINER_PREFIX}-${safeId}`;

  await ensureDockerVolume(volumeName);
  await ensureDockerContainer(containerName, volumeName);

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
    this.deadSessionTtlMs = Number.isFinite(
      Number.parseInt(process.env.NEURAL_LABS_DEAD_SESSION_TTL_MS || "", 10)
    )
      ? Math.max(15_000, Number.parseInt(process.env.NEURAL_LABS_DEAD_SESSION_TTL_MS || "", 10))
      : 5 * 60 * 1000;
    this.cleanupTimers = new Map();
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
    const shell = process.env.NEURAL_LABS_WORKSPACE_SHELL || "bash";
    if (
      workspace.backend === "docker" &&
      workspace.containerName &&
      workspace.workspacePathInContainer
    ) {
      return spawn(
        "docker",
        [
          "exec",
          "-i",
          "-w",
          workspace.workspacePathInContainer,
          "-e",
          "PS1=neural-labs$ ",
          workspace.containerName,
          shell,
          "--noprofile",
          "--norc",
          "-i",
        ],
        {
          stdio: "pipe",
          env: process.env,
        }
      );
    }

    return spawn(shell, ["--noprofile", "--norc", "-i"], {
      cwd: workspace.workspaceRoot,
      env: {
        ...process.env,
        PS1: "neural-labs$ ",
      },
      stdio: "pipe",
    });
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

    for (const [ownerUserId, sessions] of this.sessionsByUser.entries()) {
      if (ownerUserId === userId) {
        continue;
      }
      const session = sessions.get(sessionId);
      if (session) {
        return { ownerUserId, session };
      }
    }

    return null;
  }

  async createSession(userId) {
    const workspace = await ensureWorkspaceScaffold(userId);
    const child = this.buildProcess(workspace);

    const session = new TerminalSession(child);
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

    session.process.stdin.write("pwd\n");
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
    return token;
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
