/** Optional, verified historical files. Ordinary Files operations stay filesystem-native. */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { createFileManager, WorkspaceFileError } from "./file-manager.mjs";

export const IMPORTED_HISTORY_FORMAT = 1;

const id = value => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const checksum = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const fail = message => { throw new WorkspaceFileError(409, "history_conflict", message); };

export function validateHistory(manifest) {
  if (manifest?.format !== 1 || !id(manifest.workspace) || !Array.isArray(manifest.files)
      || !Array.isArray(manifest.folders) || manifest.files.length > 100000) fail("Invalid imported history manifest");
  const identities = new Set();
  const versions = new Set();
  for (const file of manifest.files) {
    if (!id(file.id) || identities.has(file.id) || typeof file.path !== "string" || file.path.startsWith("/")
        || file.path.split("/").some(part => !part || part === "." || part === ".." || /[\\\0]/.test(part))
        || !Array.isArray(file.versions) || !file.versions.length) fail("Invalid imported file identity or path");
    identities.add(file.id);
    for (const version of file.versions) {
      if (!id(version.id) || versions.has(version.id) || !checksum(version.sha256)
          || !Number.isSafeInteger(version.size) || version.size < 0 || version.size > 2 * 1024 ** 3
          || !Number.isSafeInteger(version.version) || version.version < 1
          || typeof version.name !== "string" || /[\r\n\0/\\]/.test(version.name)
          || !Number.isFinite(Date.parse(version.created_at))) fail("Invalid imported version");
      versions.add(version.id);
    }
  }
  return manifest;
}

export function createImportedHistory({ root, stateRoot = path.join(path.dirname(root), ".local/state/neural-labs/files/history") }) {
  const staging = createFileManager({ root });
  const archive = createFileManager({ root: stateRoot });
  let tail = Promise.resolve();
  async function manifest() {
    try { return validateHistory(JSON.parse(await readFile(path.join(stateRoot, "manifest.json"), "utf8"))); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  async function verify(relative, expected, keepOpen = false) {
    const resolved = await archive.resolveExisting(relative, { allowRoot: false });
    const handle = await open(resolved.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== expected.size) fail("Imported history size changed");
      const hash = createHash("sha256");
      for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
      if (hash.digest("hex") !== expected.sha256) fail("Imported history checksum changed");
      if (keepOpen) return handle;
    } catch (error) { await handle.close(); throw error; }
    finally { if (!keepOpen) await handle.close(); }
  }
  async function importManifest(input) {
    validateHistory(input);
    const previous = await manifest();
    if (previous && previous.workspace !== input.workspace) fail("Imported history belongs to another workspace");
    const incoming = new Map(input.files.flatMap(file => file.versions.map(version => [version.id, version])));
    for (const file of previous?.files ?? []) for (const version of file.versions) {
      if (JSON.stringify(incoming.get(version.id)) !== JSON.stringify(version)) fail("Existing imported history must be preserved");
    }
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    for (const file of input.files) for (const version of file.versions) {
      try { await verify(version.sha256, version); continue; }
      catch (error) { if (error.status !== 404 && error.code !== "ENOENT") throw error; }
      const source = await staging.resolveExisting(`.alshival-import/${version.sha256}`, { allowRoot: false });
      const inputHandle = await open(source.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const temporary = path.join(stateRoot, `.import-${randomUUID()}`);
      let output;
      try {
        const stat = await inputHandle.stat();
        if (!stat.isFile() || stat.size !== version.size) fail("Staged history size changed");
        output = await open(temporary, "wx", 0o400);
        const hash = createHash("sha256");
        let bytes = 0;
        for await (const chunk of inputHandle.createReadStream({ autoClose: false })) {
          bytes += chunk.length;
          if (bytes > version.size) fail("Staged file grew during import");
          hash.update(chunk);
          await output.writeFile(chunk);
        }
        if (bytes !== version.size || hash.digest("hex") !== version.sha256) fail("Staged history checksum changed");
        await output.sync();
        await output.close(); output = null;
        await rename(temporary, path.join(stateRoot, version.sha256));
      } finally {
        await inputHandle.close();
        await output?.close();
        await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
      }
    }
    const temporary = path.join(stateRoot, `.manifest-${randomUUID()}`);
    const handle = await open(temporary, "wx", 0o400);
    try { await handle.writeFile(JSON.stringify(input)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path.join(stateRoot, "manifest.json"));
    const directory = await open(stateRoot, "r");
    try { await directory.sync(); } finally { await directory.close(); }
    return { imported: true, files: input.files.length, versions: incoming.size };
  }
  return {
    async list(relative) {
      const data = await manifest();
      return { files: (data?.files ?? []).filter(file => !relative || file.path === relative), folders: data?.folders ?? [] };
    },
    import(input) {
      const result = tail.catch(() => {}).then(() => importManifest(input));
      tail = result;
      return result;
    },
    async download(versionId) {
      if (!id(versionId)) fail("Invalid history version");
      const data = await manifest();
      const version = data?.files.flatMap(file => file.versions).find(item => item.id === versionId);
      if (!version) throw new WorkspaceFileError(404, "history_not_found", "Imported version not found");
      const handle = await verify(version.sha256, version, true);
      return { name: version.name, size: version.size, mimeType: "application/octet-stream",
        stream: () => handle.createReadStream({ start: 0, autoClose: true }) };
    },
  };
}
