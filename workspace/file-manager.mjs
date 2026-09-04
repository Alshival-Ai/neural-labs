import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import path from "node:path";

const TEMPORARY_UPLOAD_PREFIX = ".neural-labs-upload-";
const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_TEXT_BYTES = 16 * 1024 * 1024;

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".aac", "audio/aac"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".flac", "audio/flac"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".m4a", "audio/mp4"],
  [".m4v", "video/mp4"],
  [".mov", "video/quicktime"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp4", "video/mp4"],
  [".mp3", "audio/mpeg"],
  [".oga", "audio/ogg"],
  [".ogg", "audio/ogg"],
  [".ogv", "video/ogg"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ts", "text/plain; charset=utf-8"],
  [".tsx", "text/plain; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".wav", "audio/wav"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".yaml", "text/yaml; charset=utf-8"],
  [".yml", "text/yaml; charset=utf-8"],
  [".zip", "application/zip"],
]);

export class WorkspaceFileError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "WorkspaceFileError";
    this.status = status;
    this.code = code;
  }
}

function invalidPath(message = "The requested workspace path is invalid") {
  return new WorkspaceFileError(400, "invalid_path", message);
}

function normalizeRelativePath(value, { allowRoot = true } = {}) {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\0") || value.includes("\\")) {
    throw invalidPath();
  }
  if (value === "" && allowRoot) return "";
  if (!value || path.posix.isAbsolute(value)) throw invalidPath();
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || Buffer.byteLength(segment) > 255)) {
    throw invalidPath();
  }
  return segments.join("/");
}

function validateName(value) {
  const name = normalizeRelativePath(value, { allowRoot: false });
  if (name.includes("/")) throw invalidPath("Names cannot contain directory separators");
  return name;
}

function mapFsError(error) {
  if (error instanceof WorkspaceFileError) return error;
  if (!error || typeof error !== "object" || !("code" in error)) return error;
  if (error.code === "ENOENT" || error.code === "ENOTDIR") {
    return new WorkspaceFileError(404, "not_found", "The requested workspace item was not found");
  }
  if (error.code === "EEXIST") {
    return new WorkspaceFileError(409, "already_exists", "An item with that name already exists");
  }
  if (error.code === "EACCES" || error.code === "EPERM") {
    return new WorkspaceFileError(403, "forbidden", "The workspace item cannot be changed");
  }
  return error;
}

function mimeType(filename) {
  return MIME_TYPES.get(path.extname(filename).toLowerCase()) ?? "application/octet-stream";
}

function publicEntry(relativePath, name, info) {
  return {
    name,
    path: relativePath,
    type: info.isDirectory() ? "folder" : "file",
    size: info.isDirectory() ? null : info.size,
    modifiedAt: info.mtime.toISOString(),
    mimeType: info.isDirectory() ? null : mimeType(name),
  };
}

function textVersion(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

export function createFileManager({
  root,
  maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
  maxTextBytes = DEFAULT_MAX_TEXT_BYTES,
}) {
  if (!root || !path.isAbsolute(root)) throw new Error("Workspace file root must be an absolute path");
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1) throw new Error("Upload limit must be a positive integer");
  if (!Number.isSafeInteger(maxTextBytes) || maxTextBytes < 1) throw new Error("Text editor limit must be a positive integer");
  const textWrites = new Map();

  function encodeText(content) {
    if (typeof content !== "string" || content.includes("\0")) {
      throw new WorkspaceFileError(415, "invalid_text", "The Editor supports UTF-8 text files without null bytes");
    }
    const bytes = Buffer.from(content, "utf8");
    if (bytes.length > maxTextBytes) {
      throw new WorkspaceFileError(413, "text_too_large", `Editor files must be ${Math.floor(maxTextBytes / 1024 / 1024)} MB or smaller`);
    }
    return bytes;
  }

  function decodeText(bytes) {
    if (bytes.includes(0)) {
      throw new WorkspaceFileError(415, "invalid_text", "The selected file is not an editable UTF-8 text file");
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new WorkspaceFileError(415, "invalid_text", "The selected file is not an editable UTF-8 text file");
    }
  }

  async function serializeTextWrite(relativePath, operation) {
    const previous = textWrites.get(relativePath) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    textWrites.set(relativePath, current);
    try {
      return await current;
    } finally {
      if (textWrites.get(relativePath) === current) textWrites.delete(relativePath);
    }
  }

  async function resolveExisting(relativeValue, { allowRoot = true } = {}) {
    const relativePath = normalizeRelativePath(relativeValue, { allowRoot });
    try {
      const rootReal = await realpath(root);
      const lexicalPath = relativePath ? path.join(rootReal, ...relativePath.split("/")) : rootReal;
      const targetReal = await realpath(lexicalPath);
      if (targetReal !== lexicalPath) throw invalidPath("Symbolic links are not available through the Files app");
      const info = await lstat(targetReal);
      if (info.isSymbolicLink()) throw invalidPath("Symbolic links are not available through the Files app");
      return { relativePath, absolutePath: targetReal, info };
    } catch (error) {
      throw mapFsError(error);
    }
  }

  async function resolveDirectory(relativeValue) {
    const target = await resolveExisting(relativeValue);
    if (!target.info.isDirectory()) {
      throw new WorkspaceFileError(400, "not_a_directory", "The selected workspace path is not a folder");
    }
    return target;
  }

  async function list(relativeValue = "") {
    const directory = await resolveDirectory(relativeValue);
    try {
      const entries = await readdir(directory.absolutePath, { withFileTypes: true });
      const items = await Promise.all(entries
        .filter((entry) => !entry.isSymbolicLink() && !entry.name.startsWith(TEMPORARY_UPLOAD_PREFIX))
        .map(async (entry) => {
          const entryPath = directory.relativePath ? `${directory.relativePath}/${entry.name}` : entry.name;
          const info = await lstat(path.join(directory.absolutePath, entry.name));
          if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) return null;
          return publicEntry(entryPath, entry.name, info);
        }));
      return {
        path: directory.relativePath,
        parent: directory.relativePath.includes("/")
          ? directory.relativePath.slice(0, directory.relativePath.lastIndexOf("/"))
          : directory.relativePath ? "" : null,
        entries: items
          .filter(Boolean)
          .sort((left, right) => Number(right.type === "folder") - Number(left.type === "folder") || left.name.localeCompare(right.name)),
      };
    } catch (error) {
      throw mapFsError(error);
    }
  }

  async function createFolder(relativeDirectory, rawName) {
    const directory = await resolveDirectory(relativeDirectory);
    const name = validateName(rawName);
    const absolutePath = path.join(directory.absolutePath, name);
    try {
      await mkdir(absolutePath, { mode: 0o750 });
      const info = await lstat(absolutePath);
      const relativePath = directory.relativePath ? `${directory.relativePath}/${name}` : name;
      return publicEntry(relativePath, name, info);
    } catch (error) {
      throw mapFsError(error);
    }
  }

  async function readText(relativeValue) {
    const target = await resolveExisting(relativeValue, { allowRoot: false });
    if (!target.info.isFile()) {
      throw new WorkspaceFileError(400, "not_a_file", "Only files can be opened in the Editor");
    }
    if (target.info.size > maxTextBytes) {
      throw new WorkspaceFileError(413, "text_too_large", `Editor files must be ${Math.floor(maxTextBytes / 1024 / 1024)} MB or smaller`);
    }
    try {
      const bytes = await readFile(target.absolutePath);
      return {
        item: publicEntry(target.relativePath, path.basename(target.absolutePath), target.info),
        content: decodeText(bytes),
        version: textVersion(bytes),
      };
    } catch (error) {
      throw mapFsError(error);
    }
  }

  async function createText(relativeDirectory, rawName, content = "") {
    const directory = await resolveDirectory(relativeDirectory);
    const name = validateName(rawName);
    const bytes = encodeText(content);
    const relativePath = directory.relativePath ? `${directory.relativePath}/${name}` : name;
    return serializeTextWrite(relativePath, async () => {
      const targetPath = path.join(directory.absolutePath, name);
      const temporaryPath = path.join(directory.absolutePath, `${TEMPORARY_UPLOAD_PREFIX}${randomUUID()}`);
      let handle;
      try {
        handle = await open(temporaryPath, "wx", 0o640);
        await handle.writeFile(bytes);
        await handle.close();
        handle = undefined;
        await link(temporaryPath, targetPath);
        await unlink(temporaryPath);
        const info = await lstat(targetPath);
        return {
          item: publicEntry(relativePath, name, info),
          content,
          version: textVersion(bytes),
        };
      } catch (error) {
        if (handle) await handle.close().catch(() => undefined);
        await unlink(temporaryPath).catch(() => undefined);
        throw mapFsError(error);
      }
    });
  }

  async function writeText(relativeValue, content, expectedVersion) {
    const relativePath = normalizeRelativePath(relativeValue, { allowRoot: false });
    if (typeof expectedVersion !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(expectedVersion)) {
      throw new WorkspaceFileError(400, "invalid_version", "A valid Editor file version is required");
    }
    const bytes = encodeText(content);
    return serializeTextWrite(relativePath, async () => {
      const target = await resolveExisting(relativePath, { allowRoot: false });
      if (!target.info.isFile()) {
        throw new WorkspaceFileError(400, "not_a_file", "Only files can be saved in the Editor");
      }
      if (target.info.size > maxTextBytes) {
        throw new WorkspaceFileError(413, "text_too_large", `Editor files must be ${Math.floor(maxTextBytes / 1024 / 1024)} MB or smaller`);
      }
      const currentBytes = await readFile(target.absolutePath);
      if (textVersion(currentBytes) !== expectedVersion) {
        throw new WorkspaceFileError(409, "edit_conflict", "This file changed after you opened it. Reload it before saving");
      }

      const temporaryPath = path.join(path.dirname(target.absolutePath), `${TEMPORARY_UPLOAD_PREFIX}${randomUUID()}`);
      let handle;
      try {
        handle = await open(temporaryPath, "wx", target.info.mode & 0o777);
        await handle.writeFile(bytes);
        await handle.close();
        handle = undefined;
        await rename(temporaryPath, target.absolutePath);
        const info = await lstat(target.absolutePath);
        return {
          item: publicEntry(relativePath, path.basename(target.absolutePath), info),
          content,
          version: textVersion(bytes),
        };
      } catch (error) {
        if (handle) await handle.close().catch(() => undefined);
        await unlink(temporaryPath).catch(() => undefined);
        throw mapFsError(error);
      }
    });
  }

  async function upload(relativeDirectory, rawName, body) {
    const directory = await resolveDirectory(relativeDirectory);
    const name = validateName(rawName);
    const targetPath = path.join(directory.absolutePath, name);
    const temporaryPath = path.join(directory.absolutePath, `${TEMPORARY_UPLOAD_PREFIX}${randomUUID()}`);
    let handle;
    let size = 0;
    let exceeded = false;
    try {
      try {
        await lstat(targetPath);
        throw new WorkspaceFileError(409, "already_exists", "An item with that name already exists");
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      }
      handle = await open(temporaryPath, "wx", 0o600);
      for await (const value of body) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        size += chunk.length;
        if (size > maxUploadBytes) {
          exceeded = true;
          continue;
        }
        await handle.write(chunk);
      }
      await handle.close();
      handle = undefined;
      if (exceeded) {
        throw new WorkspaceFileError(413, "upload_too_large", `Files must be ${Math.floor(maxUploadBytes / 1024 / 1024)} MB or smaller`);
      }
      await link(temporaryPath, targetPath);
      await unlink(temporaryPath);
      const info = await lstat(targetPath);
      const relativePath = directory.relativePath ? `${directory.relativePath}/${name}` : name;
      return publicEntry(relativePath, name, info);
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw mapFsError(error);
    }
  }

  async function remove(relativeValue) {
    const target = await resolveExisting(relativeValue, { allowRoot: false });
    try {
      if (target.info.isDirectory()) await rm(target.absolutePath, { recursive: true, force: false });
      else await unlink(target.absolutePath);
      return { deleted: true, path: target.relativePath };
    } catch (error) {
      throw mapFsError(error);
    }
  }

  async function download(relativeValue) {
    const target = await resolveExisting(relativeValue, { allowRoot: false });
    if (!target.info.isFile()) {
      throw new WorkspaceFileError(400, "not_a_file", "Only files can be downloaded");
    }
    return {
      name: path.basename(target.absolutePath),
      size: target.info.size,
      modifiedAt: target.info.mtime,
      mimeType: mimeType(target.absolutePath),
      stream: (options) => createReadStream(target.absolutePath, options),
    };
  }

  async function openTarget(relativeValue) {
    const target = await resolveExisting(relativeValue);
    if (!target.info.isFile() && !target.info.isDirectory()) {
      throw new WorkspaceFileError(400, "unsupported_item", "Only workspace files and folders can be opened in VS Code");
    }
    return {
      relativePath: target.relativePath,
      type: target.info.isDirectory() ? "folder" : "file",
    };
  }

  async function preview(relativeRoot, relativeValue = "index.html") {
    const previewRoot = await resolveExisting(relativeRoot);
    if (!previewRoot.info.isDirectory()) {
      throw new WorkspaceFileError(400, "not_a_directory", "Website previews must start from a workspace folder");
    }
    const requestedPath = normalizeRelativePath(relativeValue || "index.html", { allowRoot: false });
    const targetPath = previewRoot.relativePath ? `${previewRoot.relativePath}/${requestedPath}` : requestedPath;
    const target = await resolveExisting(targetPath, { allowRoot: false });
    if (!target.absolutePath.startsWith(`${previewRoot.absolutePath}${path.sep}`)) {
      throw invalidPath("Preview files must stay inside the selected website folder");
    }
    if (!target.info.isFile()) {
      throw new WorkspaceFileError(400, "not_a_file", "Only website files can be previewed");
    }
    return {
      name: path.basename(target.absolutePath),
      size: target.info.size,
      modifiedAt: target.info.mtime,
      mimeType: mimeType(target.absolutePath),
      stream: () => createReadStream(target.absolutePath),
    };
  }

  return {
    list,
    createFolder,
    readText,
    createText,
    writeText,
    upload,
    remove,
    download,
    openTarget,
    preview,
    maxUploadBytes,
    maxTextBytes,
  };
}
