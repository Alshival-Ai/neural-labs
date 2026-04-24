import { execFile as nodeExecFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

const execFile = promisify(nodeExecFile);

type WorkspaceBackend = "docker";

export interface WorkspaceSession {
  userId: string;
  backend: WorkspaceBackend;
  workspaceRoot: string;
  dataRoot: string;
  stateFilePath: string;
  containerName: string | null;
  volumeName: string | null;
  workspacePathInContainer: string | null;
}

const WORKSPACE_BACKEND: WorkspaceBackend = "docker";
const DOCKER_IMAGE = process.env.NEURAL_LABS_WORKSPACE_IMAGE?.trim() || "ubuntu:24.04";
const DOCKER_CONTAINER_PREFIX =
  process.env.NEURAL_LABS_CONTAINER_PREFIX?.trim() || "neural-labs-user";
const DOCKER_VOLUME_PREFIX =
  process.env.NEURAL_LABS_VOLUME_PREFIX?.trim() || "neural-labs-user";
const DOCKER_WORKSPACE_PATH =
  process.env.NEURAL_LABS_WORKSPACE_PATH?.trim() || "/home/neural-labs";
const USER_ID_SAFE_PATTERN = /[^a-z0-9_.-]/g;
const DEFAULT_AUTH_DB_PATH = path.join(
  process.env.HOME || process.cwd(),
  ".local",
  "share",
  "neural-labs",
  "auth",
  "auth.db"
);

let authDb: DatabaseSync | null = null;

function toSafeId(userId: string): string {
  const safe = userId.toLowerCase().replace(USER_ID_SAFE_PATTERN, "-");
  return safe || "default";
}

function getAuthDbPath(): string {
  return process.env.AUTH_DB_PATH?.trim() || DEFAULT_AUTH_DB_PATH;
}

function getAuthDb(): DatabaseSync {
  if (authDb) {
    return authDb;
  }

  const dbPath = getAuthDbPath();
  const directory = path.dirname(dbPath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_activity (
      user_id TEXT PRIMARY KEY,
      last_activity_at TEXT NOT NULL
    );
  `);
  authDb = db;
  return db;
}

export function markWorkspaceActivity(userId: string, at = new Date()): void {
  const timestamp = at.toISOString();
  getAuthDb()
    .prepare(
      `INSERT INTO workspace_activity (user_id, last_activity_at)
       VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET last_activity_at = excluded.last_activity_at`
    )
    .run(userId, timestamp);
}

async function runDocker(args: string[]): Promise<string> {
  const { stdout } = await execFile("docker", args, {
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

async function ensureDockerVolume(volumeName: string): Promise<void> {
  try {
    await runDocker(["volume", "inspect", volumeName]);
  } catch {
    await runDocker(["volume", "create", volumeName]);
  }
}

async function ensureDockerContainer(
  containerName: string,
  volumeName: string,
  userId: string
): Promise<void> {
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

async function resolveDockerWorkspace(userId: string): Promise<WorkspaceSession> {
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

export async function getWorkspaceSession(userId: string): Promise<WorkspaceSession> {
  if (WORKSPACE_BACKEND !== "docker") {
    throw new Error("Neural Labs workspace is configured for docker backend only.");
  }
  markWorkspaceActivity(userId);
  return resolveDockerWorkspace(userId);
}
