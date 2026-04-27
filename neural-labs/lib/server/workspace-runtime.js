const { execFile: nodeExecFile } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const execFile = promisify(nodeExecFile);

const DEFAULT_ACTIVITY_DIR = path.join(
  process.env.HOME || process.cwd(),
  ".local",
  "share",
  "neural-labs",
  "activity"
);
const WORKSPACE_BACKEND = "docker";
const DOCKER_IMAGE =
  process.env.NEURAL_LABS_WORKSPACE_IMAGE?.trim() || "neural-labs-workspace:latest";
const DOCKER_CONTAINER_PREFIX =
  process.env.NEURAL_LABS_CONTAINER_PREFIX?.trim() || "neural-labs-user";
const DOCKER_VOLUME_PREFIX =
  process.env.NEURAL_LABS_VOLUME_PREFIX?.trim() || "neural-labs-user";
const DOCKER_WORKSPACE_PATH =
  process.env.NEURAL_LABS_WORKSPACE_PATH?.trim() || "/home/neural-labs";
const DOCKER_NETWORK =
  process.env.NEURAL_LABS_WORKSPACE_NETWORK?.trim() || "neural-labs-workspaces";
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

function getActivityDirectory() {
  return process.env.NEURAL_LABS_ACTIVITY_DIR?.trim() || DEFAULT_ACTIVITY_DIR;
}

function getActivityFilePath(userId) {
  return path.join(getActivityDirectory(), `${toSafeId(userId)}.json`);
}

function markWorkspaceActivity(userId, at = new Date()) {
  const timestamp = at.toISOString();
  const activityDirectory = getActivityDirectory();
  if (!existsSync(activityDirectory)) {
    mkdirSync(activityDirectory, { recursive: true });
  }
  writeFileSync(
    getActivityFilePath(userId),
    JSON.stringify({ userId, lastActivityAt: timestamp }, null, 2),
    "utf-8"
  );
}

function markWorkspaceActivitySafe(userId, at = new Date()) {
  try {
    markWorkspaceActivity(userId, at);
  } catch (error) {
    console.warn(`[workspace/activity] Unable to persist activity for user ${userId}`, error);
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

async function ensureDockerNetwork() {
  try {
    await runDocker(["network", "inspect", DOCKER_NETWORK]);
  } catch {
    await runDocker(["network", "create", DOCKER_NETWORK]);
  }
}

async function containerHasNetwork(containerName) {
  const result = await runDocker([
    "inspect",
    "--format",
    `{{if index .NetworkSettings.Networks "${DOCKER_NETWORK}"}}true{{else}}false{{end}}`,
    containerName,
  ]);
  return result === "true";
}

async function ensureDockerContainer(containerName, volumeName, userId) {
  await ensureDockerNetwork();

  const createContainer = async () => {
    await runDocker([
      "run",
      "-d",
      "--name",
      containerName,
      "--hostname",
      containerName,
      "--network",
      DOCKER_NETWORK,
      "--label",
      "neural-labs.managed=true",
      "--label",
      `neural-labs.volume=${volumeName}`,
      "--label",
      `neural-labs.user-id=${userId}`,
      "--label",
      `neural-labs.workspace-image=${DOCKER_IMAGE}`,
      "--label",
      `neural-labs.workspace-network=${DOCKER_NETWORK}`,
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
    const image = await runDocker(["inspect", "--format", "{{ .Config.Image }}", containerName]);
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
    const hasNetwork = await containerHasNetwork(containerName);
    const shouldRecreate =
      image !== DOCKER_IMAGE ||
      workingDir !== DOCKER_WORKSPACE_PATH ||
      mountedVolume !== volumeName ||
      labeledUserId !== userId ||
      !hasNetwork;

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
    throw new Error("Neural Labs workspace is configured for docker backend only.");
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

module.exports = {
  DOCKER_CONTAINER_PREFIX,
  DOCKER_NETWORK,
  DOCKER_WORKSPACE_PATH,
  ensureWorkspaceScaffold,
  getLastWorkspaceActivityMs,
  getWorkspaceSession,
  markWorkspaceActivity,
  markWorkspaceActivitySafe,
  parseTimestampMs,
  runDocker,
  toSafeId,
};
