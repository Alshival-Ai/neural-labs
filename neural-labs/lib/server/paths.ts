import path from "node:path";

export function resolveWorkspacePath(
  workspaceRoot: string,
  relativePath = ""
): string {
  const safeRelativePath = relativePath.replace(/^\/+/, "");
  const resolved = path.resolve(workspaceRoot, safeRelativePath);

  if (
    resolved !== workspaceRoot &&
    !resolved.startsWith(`${workspaceRoot}${path.sep}`)
  ) {
    throw new Error("Path escapes the workspace");
  }

  return resolved;
}

export function toRelativeWorkspacePath(
  workspaceRoot: string,
  absolutePath: string
): string {
  const relative = path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
  return relative === "" ? "" : relative;
}
