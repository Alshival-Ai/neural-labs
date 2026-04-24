import { execFile as nodeExecFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(nodeExecFile);

type WorkspaceBackend = "docker" | "local";

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

const DEFAULT_LOCAL_DATA_ROOT = path.join(
  process.env.HOME || process.cwd(),
  ".local",
  "share",
  "neural-labs"
);
const WORKSPACE_BACKEND: WorkspaceBackend =
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

function toSafeId(userId: string): string {
  const safe = userId.toLowerCase().replace(USER_ID_SAFE_PATTERN, "-");
  return safe || "default";
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
  volumeName: string
): Promise<void> {
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

async function resolveDockerWorkspace(userId: string): Promise<WorkspaceSession> {
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

function resolveLocalWorkspace(userId: string): WorkspaceSession {
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

export async function getWorkspaceSession(userId: string): Promise<WorkspaceSession> {
  if (WORKSPACE_BACKEND === "local") {
    return resolveLocalWorkspace(userId);
  }
  return resolveDockerWorkspace(userId);
}
