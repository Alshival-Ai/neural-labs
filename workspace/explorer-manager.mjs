import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  lstat,
  unlink,
  rm,
  open,
  link,
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { ZipFile } from "yazl";
import { WorkspaceFileError } from "./file-manager.mjs";

const DAY = 86_400_000;
const fail = (status, code, message) => {
  throw new WorkspaceFileError(status, code, message);
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const exists = async (target) => {
  try {
    return await lstat(target);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
};
const parent = (value) =>
  value.includes("/") ? value.slice(0, value.lastIndexOf("/")) : "";
function name(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value === "." ||
    value === ".." ||
    /[\\/\0]/.test(value) ||
    Buffer.byteLength(value) > 255
  )
    fail(400, "invalid_name", "Enter a valid file or folder name");
  return value;
}
function relative(value) {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    value.startsWith("/") ||
    value.includes("\\")
  )
    fail(400, "invalid_path", "Use a workspace-relative path");
  if (value) value.split("/").forEach(name);
  return value;
}
function id(value) {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value))
    fail(400, "invalid_id", "Invalid item identifier");
  return value;
}
async function atomic(target, value) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, target);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
async function json(target, fallback) {
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}

/** Metadata is outside the browsable root on the same persistent home volume. */
export function createExplorerManager({
  files,
  root,
  stateRoot = path.join(path.dirname(root), ".local/state/neural-labs/files"),
  now = Date.now,
  changed = () => {},
}) {
  const jobs = new Map();
  let tail = Promise.resolve();
  let stopped = false;
  const serial = (fn) => {
    const next = tail.catch(() => {}).then(fn);
    tail = next;
    return next;
  };
  const userPath = (user) =>
    path.join(stateRoot, "users", `${hash(user)}.json`);
  const trashPath = (key) => path.join(stateRoot, "trash", id(key));
  const archivePath = (key) =>
    path.join(stateRoot, "archives", `${id(key)}.zip`);
  const defaults = () => ({ revision: 0, pins: [], recent: [] });
  const checkCancelled = (job) => {
    if (job?.cancelled || stopped)
      fail(409, "cancelled", "Operation cancelled");
  };

  async function metadata(user) {
    const data = await json(userPath(user), defaults());
    return {
      ...data,
      pins: await Promise.all(
        data.pins.map(async (pin) => ({
          ...pin,
          available: Boolean(
            await files.resolveDirectory(pin.path).catch(() => null),
          ),
        })),
      ),
    };
  }
  const saveMetadata = (user, input) =>
    serial(async () => {
      if (!input || typeof input !== "object")
        fail(400, "invalid_pins", "Send folder shortcuts and their revision");
      const data = await json(userPath(user), defaults());
      if (input.revision !== data.revision)
        fail(
          409,
          "stale_metadata",
          "Your shortcuts changed in another window. Refresh and try again.",
        );
      if (!Array.isArray(input.pins) || input.pins.length > 200)
        fail(400, "invalid_pins", "At most 200 folder shortcuts are supported");
      const seen = new Set();
      data.pins = input.pins.map((pin) => {
        if (!pin || typeof pin !== "object")
          fail(400, "invalid_pins", "Invalid folder shortcut");
        const pinPath = relative(pin.path);
        if (!pinPath || seen.has(pinPath))
          fail(400, "invalid_pins", "Shortcuts must be unique folders");
        seen.add(pinPath);
        return {
          path: pinPath,
          label: name(pin.label || path.posix.basename(pinPath)),
        };
      });
      data.revision++;
      await atomic(userPath(user), data);
      changed({ kind: "metadata", user });
      return data;
    });
  const opened = (user, itemPath) =>
    serial(async () => {
      const target = await files.openTarget(itemPath);
      if (target.type === "folder") return {};
      const data = await json(userPath(user), defaults());
      data.recent = [
        { path: itemPath, openedAt: new Date(now()).toISOString() },
        ...data.recent.filter((x) => x.path !== itemPath),
      ].slice(0, 200);
      data.revision++;
      await atomic(userPath(user), data);
      changed({ kind: "metadata", user });
      return {};
    });
  async function recent(user) {
    const data = await json(userPath(user), defaults());
    const entries = await Promise.all(
      data.recent.map(async (r) => {
        const item = await files.info(r.path).catch(() => null);
        return item ? { ...item, openedAt: r.openedAt } : null;
      }),
    );
    return { entries: entries.filter(Boolean) };
  }

  async function list(directory, options = {}) {
    const result = await files.list(directory);
    let entries = result.entries.filter(
      (entry) => options.hidden === "true" || !entry.name.startsWith("."),
    );
    const direction = options.direction === "desc" ? -1 : 1;
    const field = ["name", "modifiedAt", "size", "type"].includes(options.sort)
      ? options.sort
      : "name";
    entries.sort(
      (a, b) =>
        (options.foldersFirst !== "false"
          ? Number(b.type === "folder") - Number(a.type === "folder")
          : 0) ||
        direction *
          (field === "size"
            ? (a.size ?? 0) - (b.size ?? 0)
            : String(
                field === "type"
                  ? a.type === "folder"
                    ? "Folder"
                    : path.extname(a.name).toLowerCase()
                  : a[field],
              ).localeCompare(
                String(
                  field === "type"
                    ? b.type === "folder"
                      ? "Folder"
                      : path.extname(b.name).toLowerCase()
                    : b[field],
                ),
                undefined,
                {
                  numeric: true,
                },
              )) ||
        a.path.localeCompare(b.path),
    );
    const offset = Math.max(0, Number(options.offset) || 0);
    const limit = Math.min(1000, Math.max(1, Number(options.limit) || 500));
    return {
      ...result,
      entries: entries.slice(offset, offset + limit),
      total: entries.length,
      nextOffset: offset + limit < entries.length ? offset + limit : null,
    };
  }

  // Bounded breadth-first batches return a continuation instead of walking the whole tree per request.
  const searches = new Map();
  async function search(user, options, signal) {
    const query = String(options.q ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 255);
    if (!query) return { entries: [], cursor: null };
    let cursor = options.cursor;
    let state = cursor ? searches.get(cursor) : null;
    if (cursor && (!state || state.user !== user || state.expires < now()))
      fail(410, "expired_search", "Search expired. Search again.");
    if (!state) {
      for (const [key, value] of searches)
        if (value.expires < now()) searches.delete(key);
      if (searches.size >= 200)
        fail(
          429,
          "search_limit",
          "Too many searches. Wait a moment and try again.",
        );
      const directory =
        options.scope === "workspace" ? "" : relative(options.path ?? "");
      await files.resolveDirectory(directory);
      cursor = randomUUID();
      state = {
        user,
        query,
        hidden: options.hidden === "true",
        recursive: options.scope !== "direct",
        queue: [directory],
        pending: [],
        expires: now() + 300_000,
      };
    }
    const entries = [];
    let visited = 0;
    while (
      (state.queue.length || state.pending.length) &&
      entries.length < 200 &&
      visited < 1000 &&
      !signal?.aborted
    ) {
      if (!state.pending.length) {
        const directory = state.queue.shift();
        state.pending = (
          await files.list(directory).catch(() => ({ entries: [] }))
        ).entries;
      }
      const item = state.pending.shift();
      if (!item) continue;
      visited++;
      if (!state.hidden && item.name.startsWith(".")) continue;
      if (item.type === "folder" && state.recursive)
        state.queue.push(item.path);
      if (item.name.toLowerCase().includes(state.query)) entries.push(item);
    }
    state.expires = now() + 300_000;
    if (state.queue.length || state.pending.length) searches.set(cursor, state);
    else {
      searches.delete(cursor);
      cursor = null;
    }
    return { entries, cursor };
  }

  async function walk(source, callback, job) {
    checkCancelled(job);
    const target = await files.resolveExisting(source, { allowRoot: false });
    if (!target.info.isDirectory() && !target.info.isFile())
      fail(400, "invalid_type", "Only regular files and folders are supported");
    await callback(target);
    if (target.info.isDirectory()) {
      for (const entry of await readdir(target.absolutePath))
        await walk(`${source}/${entry}`, callback, job);
    }
  }
  async function putTrash(source, user, reason = "deleted") {
    const target = await files.resolveExisting(source, { allowRoot: false });
    let size = 0;
    await walk(source, async (entry) => {
      if (entry.info.isFile()) size += entry.info.size;
    });
    const key = randomUUID();
    const location = trashPath(key);
    const record = {
      id: key,
      path: source,
      name: path.posix.basename(source),
      type: target.info.isDirectory() ? "folder" : "file",
      size,
      deletedBy: user,
      deletedAt: new Date(now()).toISOString(),
      expiresAt: new Date(now() + 90 * DAY).toISOString(),
      reason,
      state: "preparing",
    };
    await atomic(path.join(location, "record.json"), record);
    await rename(target.absolutePath, path.join(location, "content"));
    record.state = "ready";
    await atomic(path.join(location, "record.json"), record);
    changed({ kind: "trash", paths: [source] });
    return record;
  }
  async function trash() {
    const keys = await readdir(path.join(stateRoot, "trash")).catch((e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
    const records = await Promise.all(
      keys
        .filter((key) => /^[a-f0-9-]{36}$/.test(key))
        .map((key) => json(path.join(trashPath(key), "record.json"), null)),
    );
    return {
      entries: records
        .filter((r) => r?.state === "ready")
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)),
    };
  }
  async function destination(directory, rawName, conflict, user, source) {
    const dir = await files.resolveDirectory(relative(directory));
    let chosen = name(rawName);
    let target = directory ? `${directory}/${chosen}` : chosen;
    if (
      source &&
      (target.startsWith(`${source}/`) ||
        (target === source && conflict === "replace"))
    )
      fail(
        400,
        "invalid_destination",
        "Choose a destination outside the source folder",
      );
    if (await exists(path.join(dir.absolutePath, chosen))) {
      if (conflict === "skip") return null;
      if (conflict === "keep-both") {
        const ext = path.extname(chosen);
        const stem = chosen.slice(0, chosen.length - ext.length);
        let n = 2;
        while (await exists(path.join(dir.absolutePath, chosen)))
          chosen = name(`${stem} (${n++})${ext}`);
        target = directory ? `${directory}/${chosen}` : chosen;
      } else if (conflict === "replace") {
        // Never replace an ancestor of the source being transferred.
        if (source?.startsWith(`${target}/`))
          fail(400, "invalid_destination", "Cannot replace a source ancestor");
        await putTrash(target, user, "replaced");
      } else fail(409, "already_exists", `“${chosen}” already exists`);
    }
    return { path: target, absolute: path.join(dir.absolutePath, chosen) };
  }
  async function updatePaths(source, destinationPath) {
    const users = await readdir(path.join(stateRoot, "users")).catch((e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
    const remap = (p) =>
      p === source || p.startsWith(`${source}/`)
        ? destinationPath + p.slice(source.length)
        : p;
    for (const key of users.filter((v) => /^[a-f0-9]{64}\.json$/.test(v))) {
      const target = path.join(stateRoot, "users", key);
      const data = await json(target, defaults());
      data.pins = data.pins.map((p) => ({
        ...p,
        path: remap(p.path),
        label:
          p.path === source ? path.posix.basename(destinationPath) : p.label,
      }));
      data.recent = data.recent.map((p) => ({ ...p, path: remap(p.path) }));
      data.revision++;
      await atomic(target, data);
    }
    changed({
      kind: "move",
      paths: [source, destinationPath],
      from: source,
      to: destinationPath,
    });
  }
  async function transfer(item, user, job) {
    const source = relative(item.path);
    const target = await files.resolveExisting(source, { allowRoot: false });
    if (item.version) {
      const record = await files.info(source);
      if (record?.version !== item.version)
        fail(409, "stale_file", "The source changed. Refresh and try again.");
    }
    await walk(source, async () => {}, job); // Validate every descendant before changing anything.
    const dest = await destination(
      relative(item.destination ?? parent(source)),
      item.name || path.posix.basename(source),
      item.conflict,
      user,
      source,
    );
    if (!dest) return { status: "skipped", path: source };
    const journalPath = path.join(stateRoot, "journal", `${randomUUID()}.json`);
    const staging = path.join(
      path.dirname(dest.absolute),
      `.neural-labs-upload-${randomUUID()}`,
    );
    const journal = {
      source,
      destination: dest.path,
      staging,
      action: item.action,
      state: "preparing",
    };
    await atomic(journalPath, journal);
    try {
      if (item.action === "move" || item.action === "rename") {
        await rename(target.absolutePath, dest.absolute);
        await updatePaths(source, dest.path);
      } else {
        await walk(
          source,
          async (entry) => {
            const out = staging + entry.relativePath.slice(source.length);
            if (entry.info.isDirectory()) await mkdir(out, { mode: 0o750 });
            else {
              const controller = new AbortController();
              job.controller = controller;
              const input = createReadStream(entry.absolutePath, {
                flags: "r",
              });
              input.on("data", (bytes) => {
                job.bytes += bytes.length;
              });
              await pipeline(
                input,
                createWriteStream(out, { flags: "wx", mode: 0o600 }),
                { signal: controller.signal },
              );
              job.controller = null;
            }
          },
          job,
        );
        checkCancelled(job);
        await rename(staging, dest.absolute);
      }
      await unlink(journalPath);
      return { status: "completed", path: source, destination: dest.path };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  async function restore(item, user) {
    const location = trashPath(item.id);
    const record = await json(path.join(location, "record.json"), null);
    if (!record || record.state !== "ready")
      fail(404, "not_found", "Trash item is unavailable");
    const dest = await destination(
      relative(item.destination ?? parent(record.path)),
      item.name || record.name,
      item.conflict,
      user,
    );
    if (!dest) return { status: "skipped", id: item.id };
    record.state = "restoring";
    record.restorePath = dest.path;
    await atomic(path.join(location, "record.json"), record);
    await rename(path.join(location, "content"), dest.absolute);
    await rm(location, { recursive: true });
    return { status: "completed", path: dest.path, id: item.id };
  }

  function enqueue(user, input) {
    if (!input || typeof input !== "object")
      fail(400, "invalid_batch", "Provide an operation batch");
    if (
      !Array.isArray(input.items) ||
      input.items.length < 1 ||
      input.items.length > 1000
    )
      fail(400, "invalid_batch", "Select between 1 and 1000 items");
    const actions = [
      "move",
      "copy",
      "rename",
      "trash",
      "restore",
      "purge",
      "archive",
    ];
    if (input.items.some((i) => !i || !actions.includes(i.action)))
      fail(400, "invalid_action", "Unknown file operation");
    if (
      [...jobs.values()].filter((job) =>
        ["queued", "running"].includes(job.state),
      ).length >= 100
    )
      fail(
        429,
        "queue_full",
        "The file operation queue is full. Try again after current transfers finish.",
      );
    const job = {
      id: randomUUID(),
      user,
      items: input.items,
      state: "queued",
      bytes: 0,
      completed: 0,
      total: input.items.length,
      results: [],
      cancelled: false,
      createdAt: now(),
      controller: null,
    };
    jobs.set(job.id, job);
    serial(async () => {
      await atomic(path.join(stateRoot, "operations", `${job.id}.json`), {
        ...snapshot(job),
        user,
      });
      job.state = "running";
      for (const item of input.items) {
        try {
          checkCancelled(job);
          let result;
          if (item.action === "trash") {
            const r = await putTrash(relative(item.path), user);
            result = { status: "completed", path: item.path, id: r.id };
          } else if (item.action === "restore")
            result = await restore(item, user);
          else if (item.action === "purge") {
            const record = await json(
              path.join(trashPath(item.id), "record.json"),
              null,
            );
            if (!record || record.state !== "ready")
              fail(404, "not_found", "Trash item is unavailable");
            await rm(trashPath(item.id), { recursive: true });
            result = { status: "completed", id: item.id };
          } else if (item.action === "archive")
            result = await archive(item.paths, job);
          else result = await transfer(item, user, job);
          job.results.push(result);
        } catch (e) {
          job.results.push({
            status: job.cancelled ? "cancelled" : "failed",
            path: item.path,
            id: item.id,
            code: e.code || "operation_failed",
            message: e.message,
          });
        }
        job.completed++;
        await atomic(path.join(stateRoot, "operations", `${job.id}.json`), {
          ...snapshot(job),
          user,
        });
        changed({ kind: "operation", user, jobId: job.id });
      }
      job.state = job.cancelled ? "cancelled" : "finished";
      await atomic(path.join(stateRoot, "operations", `${job.id}.json`), {
        ...snapshot(job),
        user,
      });
      changed({ kind: "files", paths: [] });
      changed({ kind: "operation", user, jobId: job.id });
    }).catch((e) => {
      job.state = "failed";
      job.results.push({ status: "failed", message: e.message });
    });
    return snapshot(job);
  }
  const snapshot = ({ controller, user, ...job }) => job;
  function operation(user, key, cancel = false) {
    const job = jobs.get(id(key));
    if (!job || job.user !== user)
      fail(404, "not_found", "Operation not found");
    if (cancel) {
      job.cancelled = true;
      job.controller?.abort();
    }
    return snapshot(job);
  }
  async function archive(paths, job) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 1000)
      fail(400, "invalid_paths", "Select files or folders to download");
    const zip = new ZipFile();
    const output = archivePath(job.id);
    await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    const controller = new AbortController();
    job.controller = controller;
    zip.on("error", (error) => zip.outputStream.destroy(error));
    const result = pipeline(
      zip.outputStream,
      createWriteStream(output, { flags: "wx", mode: 0o600 }),
      { signal: controller.signal },
    );
    result.catch(() => {});
    try {
      const selected = [...new Set(paths.map(relative))].filter(
        (p, _, all) => !all.some((other) => p.startsWith(`${other}/`)),
      );
      for (const p of selected) {
        await walk(
          p,
          async (entry) => {
            const archiveName = entry.relativePath;
            if (entry.info.isDirectory()) zip.addEmptyDirectory(archiveName);
            else
              zip.addFile(entry.absolutePath, archiveName, {
                mtime: entry.info.mtime,
              });
          },
          job,
        );
      }
      zip.end();
      await result;
      const info = await lstat(output);
      job.bytes = info.size;
      return {
        status: "completed",
        download: `/workspace/api/files/archives/${job.id}`,
        expiresAt: new Date(now() + 3_600_000).toISOString(),
      };
    } catch (e) {
      controller.abort();
      await result.catch(() => {});
      await unlink(output).catch(() => {});
      throw e;
    } finally {
      job.controller = null;
    }
  }
  async function downloadArchive(user, key) {
    const job = jobs.get(id(key));
    if (
      !job ||
      job.user !== user ||
      job.state !== "finished" ||
      now() - job.createdAt > 3_600_000
    )
      fail(404, "not_found", "Archive expired or unavailable");
    const target = archivePath(key);
    const info = await lstat(target);
    return {
      size: info.size,
      stream: createReadStream(target),
      cleanup: () => unlink(target).catch(() => {}),
    };
  }

  const upload = (user, directory, rawName, body, { version, conflict } = {}) =>
    serial(async () => {
      const dir = await files.resolveDirectory(relative(directory));
      const requestedName = name(rawName);
      const requested = directory
        ? `${directory}/${requestedName}`
        : requestedName;
      const before = await files.info(requested).catch((error) => {
        if (error.code === "not_found") return null;
        throw error;
      });
      if (version && before?.version !== version)
        fail(
          409,
          "stale_file",
          "This file changed. Save a copy or reload before saving.",
        );
      if (before && !version && !conflict)
        fail(409, "already_exists", "An item with that name already exists");
      const temporary = path.join(
        dir.absolutePath,
        `.neural-labs-upload-${randomUUID()}`,
      );
      let handle;
      try {
        handle = await open(temporary, "wx", 0o600);
        let bytes = 0;
        for await (const chunk of body) {
          bytes += chunk.length;
          if (bytes > files.maxUploadBytes)
            fail(413, "upload_too_large", "File exceeds the upload limit");
          await handle.writeFile(chunk);
        }
        await handle.close();
        handle = null;
        if (version) {
          const after = await files.info(requested).catch((error) => {
            if (error.code === "not_found") return null;
            throw error;
          });
          if (after?.version !== version)
            fail(
              409,
              "stale_file",
              "This file changed while saving. Save a copy instead.",
            );
        }
        const dest = await destination(
          directory,
          requestedName,
          version ? "replace" : conflict,
          user,
        );
        if (!dest) return { skipped: true };
        await link(temporary, dest.absolute);
        const item = await files.info(dest.path);
        changed({ kind: "files", paths: [dest.path] });
        return { item };
      } finally {
        await handle?.close().catch(() => {});
        await unlink(temporary).catch(() => {});
      }
    });

  async function maintain() {
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    const records = await readdir(path.join(stateRoot, "operations")).catch(
      () => [],
    );
    for (const recordName of records.filter((v) =>
      /^[a-f0-9-]{36}\.json$/.test(v),
    )) {
      const location = path.join(stateRoot, "operations", recordName);
      const record = await json(location, null);
      if (!record) continue;
      if (now() - record.createdAt > DAY) {
        if (!["queued", "running"].includes(jobs.get(record.id)?.state)) {
          jobs.delete(record.id);
          await unlink(location);
        }
        continue;
      }
      if (!jobs.has(record.id)) {
        if (["queued", "running"].includes(record.state)) {
          record.state = "failed";
          record.results.push({
            status: "failed",
            message:
              "Interrupted by workspace restart. Review completed items before retrying.",
          });
        }
        jobs.set(record.id, { ...record, controller: null });
      }
    }
    const trashKeys = await readdir(path.join(stateRoot, "trash")).catch(
      () => [],
    );
    for (const key of trashKeys.filter((v) => /^[a-f0-9-]{36}$/.test(v))) {
      const location = trashPath(key);
      const record = await json(path.join(location, "record.json"), null);
      if (!record) continue;
      const content = await exists(path.join(location, "content"));
      if (record.state !== "ready") {
        if (content) {
          record.state = "ready";
          await atomic(path.join(location, "record.json"), record);
        } else {
          await rm(location, { recursive: true });
          continue;
        }
      }
      if (Date.parse(record.expiresAt) <= now())
        await rm(location, { recursive: true });
    }
    const journalKeys = await readdir(path.join(stateRoot, "journal")).catch(
      () => [],
    );
    for (const key of journalKeys.filter((v) =>
      /^[a-f0-9-]{36}\.json$/.test(v),
    )) {
      const target = path.join(stateRoot, "journal", key);
      const record = await json(target, null);
      if (!record) continue;
      if (["move", "rename"].includes(record.action)) {
        const source = await files
          .resolveExisting(record.source)
          .catch(() => null);
        const dest = await files
          .resolveExisting(record.destination)
          .catch(() => null);
        if (!source && dest)
          await updatePaths(record.source, record.destination);
      } else if (
        record.staging &&
        path.basename(record.staging).startsWith(".neural-labs-upload-") &&
        path.resolve(record.staging).startsWith(`${path.resolve(root)}/`)
      ) {
        await rm(record.staging, { recursive: true, force: true });
      }
      await unlink(target);
    }
    for (const [key, search] of searches)
      if (search.expires < now()) searches.delete(key);
    const archives = await readdir(path.join(stateRoot, "archives")).catch(
      () => [],
    );
    for (const key of archives.filter((v) => /^[a-f0-9-]{36}\.zip$/.test(v))) {
      const target = path.join(stateRoot, "archives", key);
      const info = await lstat(target);
      if (now() - info.mtimeMs > 3_600_000) await unlink(target);
    }
    for (const [key, job] of jobs)
      if (
        !["queued", "running"].includes(job.state) &&
        now() - job.createdAt > DAY
      )
        jobs.delete(key);
  }
  const ready = serial(maintain);
  ready.catch((e) => console.error("Files recovery failed", e.message));
  const timer = setInterval(
    () =>
      serial(maintain).catch((e) =>
        console.error("Files cleanup failed", e.message),
      ),
    3_600_000,
  );
  timer.unref();
  return {
    metadata,
    saveMetadata,
    opened,
    recent,
    list,
    search,
    trash,
    enqueue,
    operation,
    operations(user) {
      return {
        operations: [...jobs.values()]
          .filter((job) => job.user === user)
          .map(snapshot),
      };
    },
    downloadArchive,
    upload,
    ready,
    maintain: () => serial(maintain),
    close() {
      stopped = true;
      clearInterval(timer);
      for (const job of jobs.values()) job.controller?.abort();
      return tail.catch(() => {});
    },
  };
}
