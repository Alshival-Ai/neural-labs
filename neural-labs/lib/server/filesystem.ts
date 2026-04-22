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
import { resolveWorkspacePath, toRelativeWorkspacePath } from "@/lib/server/paths";
import { ensureDataScaffold } from "@/lib/server/store";

function sanitizeName(name: string): string {
  const nextName = name.trim().replace(/[\\/]/g, "-");
  if (!nextName || nextName === "." || nextName === "..") {
    throw new Error("A valid name is required");
  }
  return nextName;
}

async function toFileEntry(absolutePath: string): Promise<FileEntry> {
  const fileStat = await stat(absolutePath);
  const relativePath = toRelativeWorkspacePath(absolutePath);
  return {
    name: path.basename(absolutePath),
    path: relativePath,
    isDirectory: fileStat.isDirectory(),
    size: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    mimeType: getMimeType(absolutePath, fileStat.isDirectory()),
  };
}

export async function listDirectory(relativePath = ""): Promise<DirectoryListing> {
  await ensureDataScaffold();
  const targetPath = resolveWorkspacePath(relativePath);
  const directoryStat = await stat(targetPath).catch(() => null);
  if (!directoryStat || !directoryStat.isDirectory()) {
    throw new Error("Directory not found");
  }

  const names = await readdir(targetPath);
  const entries = await Promise.all(
    names
      .sort((left, right) => left.localeCompare(right))
      .map((name) => toFileEntry(path.join(targetPath, name)))
  );

  return {
    path: toRelativeWorkspacePath(targetPath),
    entries,
  };
}

export async function readWorkspaceFile(relativePath: string): Promise<{
  content: Buffer;
  filename: string;
  mimeType: string;
}> {
  await ensureDataScaffold();
  const targetPath = resolveWorkspacePath(relativePath);
  const fileStat = await stat(targetPath).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    throw new Error("File not found");
  }

  return {
    content: await readFile(targetPath),
    filename: path.basename(targetPath),
    mimeType: getMimeType(targetPath),
  };
}

export async function writeWorkspaceTextFile(
  relativePath: string,
  content: string
): Promise<string> {
  await ensureDataScaffold();
  const safeRelativePath = relativePath.replace(/^\/+/, "");
  if (!safeRelativePath) {
    throw new Error("A file path is required");
  }
  const targetPath = resolveWorkspacePath(safeRelativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf-8");
  return toRelativeWorkspacePath(targetPath);
}

export async function createWorkspaceDirectory(
  parentPath: string,
  name: string
): Promise<string> {
  await ensureDataScaffold();
  const safeName = sanitizeName(name);
  const targetPath = resolveWorkspacePath(path.posix.join(parentPath, safeName));
  await mkdir(targetPath, { recursive: false });
  return toRelativeWorkspacePath(targetPath);
}

export async function renameWorkspacePath(
  relativePath: string,
  nextName: string
): Promise<string> {
  await ensureDataScaffold();
  const sourcePath = resolveWorkspacePath(relativePath);
  const targetPath = path.join(path.dirname(sourcePath), sanitizeName(nextName));
  await rename(sourcePath, targetPath);
  return toRelativeWorkspacePath(targetPath);
}

export async function moveWorkspacePath(
  relativePath: string,
  destinationParentPath: string,
  nextName?: string
): Promise<string> {
  await ensureDataScaffold();
  const sourcePath = resolveWorkspacePath(relativePath);
  const filename = nextName ? sanitizeName(nextName) : path.basename(sourcePath);
  const targetPath = resolveWorkspacePath(
    path.posix.join(destinationParentPath, filename)
  );
  await mkdir(path.dirname(targetPath), { recursive: true });
  await rename(sourcePath, targetPath);
  return toRelativeWorkspacePath(targetPath);
}

export async function deleteWorkspacePath(relativePath: string): Promise<void> {
  await ensureDataScaffold();
  const targetPath = resolveWorkspacePath(relativePath);
  await rm(targetPath, { recursive: true, force: false });
}

export async function uploadWorkspaceFile(
  parentPath: string,
  filename: string,
  content: Buffer
): Promise<string> {
  await ensureDataScaffold();
  const safeName = sanitizeName(filename);
  const targetPath = resolveWorkspacePath(path.posix.join(parentPath, safeName));
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
  return toRelativeWorkspacePath(targetPath);
}
