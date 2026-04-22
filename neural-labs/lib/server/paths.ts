import path from "node:path";

const DATA_ROOT = path.join(process.cwd(), ".neural-labs-data");
const WORKSPACE_ROOT = path.join(DATA_ROOT, "workspace");
const STATE_FILE = path.join(DATA_ROOT, "state.json");

export function getDataRoot(): string {
  return DATA_ROOT;
}

export function getWorkspaceRoot(): string {
  return WORKSPACE_ROOT;
}

export function getStateFilePath(): string {
  return STATE_FILE;
}

export function resolveWorkspacePath(relativePath = ""): string {
  const safeRelativePath = relativePath.replace(/^\/+/, "");
  const resolved = path.resolve(WORKSPACE_ROOT, safeRelativePath);

  if (
    resolved !== WORKSPACE_ROOT &&
    !resolved.startsWith(`${WORKSPACE_ROOT}${path.sep}`)
  ) {
    throw new Error("Path escapes the workspace");
  }

  return resolved;
}

export function toRelativeWorkspacePath(absolutePath: string): string {
  const relative = path.relative(WORKSPACE_ROOT, absolutePath).replace(/\\/g, "/");
  return relative === "" ? "" : relative;
}
