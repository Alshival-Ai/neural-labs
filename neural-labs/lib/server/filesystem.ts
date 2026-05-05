import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { DirectoryListing, FileEntry } from "@/lib/shared/types";
import { getMimeType } from "@/lib/server/mime";
import { ensureDataScaffold } from "@/lib/server/store";
import { getWorkspaceSession } from "@/lib/server/workspace-session";

function sanitizeName(name: string): string {
  const nextName = name.trim().replace(/[\\/]/g, "-");
  if (!nextName || nextName === "." || nextName === "..") {
    throw new Error("A valid name is required");
  }
  return nextName;
}

const CUSTOM_BACKGROUND_DIRECTORY = ".neural-labs/backgrounds";
const CUSTOM_BACKGROUND_BASENAME = "custom-background";

function resolveWorkspacePath(workspaceRoot: string, relativePath = ""): string {
  const safeRelativePath = relativePath.replace(/^\/+/, "");
  const resolved = path.resolve(workspaceRoot, safeRelativePath);

  if (resolved !== workspaceRoot && !resolved.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error("Path escapes the workspace");
  }

  return resolved;
}

function toRelativeWorkspacePath(workspaceRoot: string, absolutePath: string): string {
  const relative = path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
  return relative === "" ? "" : relative;
}

function getBackgroundExtension(filename: string, mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/png") {
    return ".png";
  }
  if (normalized === "image/jpeg") {
    return ".jpg";
  }
  if (normalized === "image/webp") {
    return ".webp";
  }
  if (normalized === "image/gif") {
    return ".gif";
  }
  if (normalized === "image/svg+xml") {
    return ".svg";
  }

  const fallback = path.extname(filename).toLowerCase();
  return fallback || ".png";
}

async function toFileEntry(
  workspaceRoot: string,
  absolutePath: string
): Promise<FileEntry> {
  const fileStat = await stat(absolutePath);
  const relativePath = toRelativeWorkspacePath(workspaceRoot, absolutePath);
  return {
    name: path.basename(absolutePath),
    path: relativePath,
    isDirectory: fileStat.isDirectory(),
    size: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    mimeType: getMimeType(absolutePath, fileStat.isDirectory()),
  };
}

export async function listDirectory(
  userId: string,
  relativePath = ""
): Promise<DirectoryListing> {
  await ensureDataScaffold(userId);
  const { workspaceRoot } = await getWorkspaceSession(userId);
  const targetPath = resolveWorkspacePath(workspaceRoot, relativePath);
  const directoryStat = await stat(targetPath).catch(() => null);
  if (!directoryStat || !directoryStat.isDirectory()) {
    throw new Error("Directory not found");
  }

  const names = await readdir(targetPath);
  const entries = await Promise.all(
    names
      .sort((left, right) => left.localeCompare(right))
      .map((name) => toFileEntry(workspaceRoot, path.join(targetPath, name)))
  );

  return {
    path: toRelativeWorkspacePath(workspaceRoot, targetPath),
    entries,
  };
}

export async function readWorkspaceFile(userId: string, relativePath: string): Promise<{
  content: Buffer;
  filename: string;
  mimeType: string;
  size: number;
  modifiedAt: string;
  etag: string;
}> {
  const metadata = await getWorkspaceFileMetadata(userId, relativePath);
  const { workspaceRoot } = await getWorkspaceSession(userId);
  const targetPath = resolveWorkspacePath(workspaceRoot, relativePath);

  return {
    ...metadata,
    content: await readFile(targetPath),
  };
}

export async function getWorkspaceFileMetadata(userId: string, relativePath: string): Promise<{
  filename: string;
  mimeType: string;
  size: number;
  modifiedAt: string;
  etag: string;
}> {
  await ensureDataScaffold(userId);
  const { workspaceRoot } = await getWorkspaceSession(userId);
  const targetPath = resolveWorkspacePath(workspaceRoot, relativePath);
  const fileStat = await stat(targetPath).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    throw new Error("File not found");
  }

  return {
    filename: path.basename(targetPath),
    mimeType: getMimeType(targetPath),
    size: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    etag: `"${fileStat.size.toString(16)}-${Math.trunc(fileStat.mtimeMs).toString(16)}"`,
  };
}

export async function writeWorkspaceTextFile(
  userId: string,
  relativePath: string,
  content: string
): Promise<string> {
  await ensureDataScaffold(userId);
  const { workspaceRoot } = await getWorkspaceSession(userId);
  const safeRelativePath = relativePath.replace(/^\/+/, "");
  if (!safeRelativePath) {
    throw new Error("A file path is required");
  }
  const targetPath = resolveWorkspacePath(workspaceRoot, safeRelativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf-8");
  return toRelativeWorkspacePath(workspaceRoot, targetPath);
}

export async function createWorkspaceDirectory(
  userId: string,
  parentPath: string,
  name: string
): Promise<string> {
  await ensureDataScaffold(userId);
  const { workspaceRoot } = await getWorkspaceSession(userId);
  const safeName = sanitizeName(name);
  const targetPath = resolveWorkspacePath(
    workspaceRoot,
    path.posix.join(parentPath, safeName)
  );
  await mkdir(targetPath, { recursive: false });
  return toRelativeWorkspacePath(workspaceRoot, targetPath);
}

export async function renameWorkspacePath(
  userId: string,
  relativePath: string,
  nextName: string
): Promise<string> {
  await ensureDataScaffold(userId);
  const { workspaceRoot } = await getWorkspaceSession(userId);
  const sourcePath = resolveWorkspacePath(workspaceRoot, relativePath);
  const targetPath = path.join(path.dirname(sourcePath), sanitizeName(nextName));
  await rename(sourcePath, targetPath);
  return toRelativeWorkspacePath(workspaceRoot, targetPath);
}

export async function moveWorkspacePath(
  userId: string,
  relativePath: string,
  destinationParentPath: string,
  nextName?: string
): Promise<string> {
  await ensureDataScaffold(userId);
  const { workspaceRoot } = await getWorkspaceSession(userId);
  const sourcePath = resolveWorkspacePath(workspaceRoot, relativePath);
  const filename = nextName ? sanitizeName(nextName) : path.basename(sourcePath);
  const targetPath = resolveWorkspacePath(
    workspaceRoot,
    path.posix.join(destinationParentPath, filename)
  );
  await mkdir(path.dirname(targetPath), { recursive: true });
  await rename(sourcePath, targetPath);
  return toRelativeWorkspacePath(workspaceRoot, targetPath);
}

export async function deleteWorkspacePath(
  userId: string,
  relativePath: string
): Promise<void> {
  await ensureDataScaffold(userId);
  const { workspaceRoot } = await getWorkspaceSession(userId);
  const targetPath = resolveWorkspacePath(workspaceRoot, relativePath);
  await rm(targetPath, { recursive: true, force: false });
}

export async function uploadWorkspaceFile(
  userId: string,
  parentPath: string,
  filename: string,
  content: Buffer
): Promise<string> {
  await ensureDataScaffold(userId);
  const { workspaceRoot } = await getWorkspaceSession(userId);
  const safeName = sanitizeName(filename);
  const targetPath = resolveWorkspacePath(
    workspaceRoot,
    path.posix.join(parentPath, safeName)
  );
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
  return toRelativeWorkspacePath(workspaceRoot, targetPath);
}

export async function setWorkspaceBackgroundFromFile(
  userId: string,
  relativePath: string
): Promise<string> {
  const { content, filename, mimeType } = await readWorkspaceFile(userId, relativePath);
  if (!mimeType.toLowerCase().startsWith("image/")) {
    throw new Error("Only image files can be set as desktop backgrounds");
  }

  const targetFilename = `${CUSTOM_BACKGROUND_BASENAME}${getBackgroundExtension(
    filename,
    mimeType
  )}`;

  return uploadWorkspaceFile(userId, CUSTOM_BACKGROUND_DIRECTORY, targetFilename, content);
}
