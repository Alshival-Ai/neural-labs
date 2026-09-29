import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { canonical, digest, identity } from "./state.mjs";

export const RECORD_CATEGORIES = Object.freeze([
  "jobs", "receipts", "scratch", "proposals", "checkpoints", "ownership", "skillSettings",
  "notification_preferences", "automation_subscriptions", "notification_config",
  "notification_run_summaries", "notification_events", "notification_deliveries", "sourceTables",
]);
export const TREE_CATEGORIES = Object.freeze(["teamSkills", "personalSkills", "drafts", "proposalPackages", "installedSkills", "artifacts"]);
const SCHEMA = "neural-labs.native-preservation.v1";

function relative(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0")
      || path.posix.isAbsolute(value) || value.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Invalid preservation path");
  }
  return value;
}
function child(root, name) { return path.join(root, ...relative(name).split("/")); }
function hash(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid preservation hash");
  return value;
}
async function regularFile(filename) {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("Preservation sources must be regular files");
    const data = await handle.readFile();
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Source changed during export; drain work first");
    return { data, mode: before.mode & 0o777 };
  } finally { await handle.close(); }
}
async function writeOnce(filename, data) {
  let handle;
  try { handle = await open(filename, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!(await regularFile(filename)).data.equals(Buffer.from(data))) throw new Error("Preservation destination conflicts; retained data was not overwritten");
    return;
  }
  try { await handle.writeFile(data); await handle.sync(); }
  finally { await handle.close(); }
}
async function directory(root) {
  if (!(await lstat(root)).isDirectory()) throw new Error("Preservation roots must be directories, not links");
  if (await realpath(root) !== path.resolve(root)) throw new Error("Preservation roots cannot traverse symlinks");
}
async function mkdirBelow(root, relativeName) {
  let current = root;
  for (const part of relative(relativeName).split("/")) {
    current = path.join(current, part);
    try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    await directory(current);
  }
  return current;
}

// Every collection is explicit, including empty collections. Callers export
// control-plane rows in one repeatable-read transaction and retrieve *all*
// scheduler pages before calling this function. It never contacts a Gateway,
// PostgreSQL, an AI provider or a delivery transport.
export async function exportPreservation({ workspace, trees, records, destination, chatResetPolicy }) {
  identity(workspace);
  if (!["preserve", "reset-team-pilot", "separately-authorized-reset"].includes(chatResetPolicy)) throw new Error("Record this workspace's chat-reset policy explicitly");
  if (canonical(Object.keys(trees).sort()) !== canonical([...TREE_CATEGORIES].sort())
      || canonical(Object.keys(records).sort()) !== canonical([...RECORD_CATEGORIES].sort())) throw new Error("Complete preservation collections are required, including empty ones");
  // Destination must be new. An interrupted export is evidence, not a resumable
  // snapshot: export again after checking that the source is still quiescent.
  await mkdir(destination, { mode: 0o700 });
  await directory(destination);
  await mkdir(path.join(destination, "blobs"), { mode: 0o700 });
  const files = [], inventory = {};
  for (const category of TREE_CATEGORIES) {
    const root = path.resolve(trees[category]);
    await directory(root);
    const destRelative = path.relative(root, destination);
    if (!destRelative || (!destRelative.startsWith(".." + path.sep) && destRelative !== ".." && !path.isAbsolute(destRelative))) throw new Error("Export destination cannot be inside a source tree");
    const before = files.length;
    async function walk(directoryName, prefix = "") {
      await directory(directoryName);
      const entries = (await readdir(directoryName, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const name = prefix + entry.name, source = child(root, name);
        if (entry.isDirectory()) {
          const stat = await lstat(source);
          files.push({ category, path: name, type: "directory", mode: stat.mode & 0o777 });
          await walk(source, name + "/");
        } else if (entry.isFile()) {
          const { data, mode } = await regularFile(source), sha256 = digest(data);
          await writeOnce(path.join(destination, "blobs", sha256), data);
          files.push({ category, path: name, type: "file", mode, size: data.length, sha256 });
        } else {
          // Do not silently skip a link, socket, or device. The operator must
          // inventory its target explicitly or retain it through a reviewed map.
          throw new Error(`Unsupported filesystem entry in ${category}; export remains incomplete`);
        }
      }
    }
    await walk(root);
    const rows = files.slice(before);
    inventory[category] = { files: rows.filter(row => row.type === "file").length,
      directories: rows.filter(row => row.type === "directory").length,
      packages: rows.filter(row => row.type === "directory" && !row.path.includes("/")).length };
  }
  const retained = [];
  for (const category of RECORD_CATEGORIES) {
    if (!Array.isArray(records[category])) throw new Error(`Invalid ${category} collection`);
    const keys = new Set();
    for (const entry of records[category]) {
      if (!entry || typeof entry.key !== "string" || !entry.key || entry.key.length > 1024 || keys.has(entry.key)
          || entry.value === undefined) throw new Error(`Missing or duplicated ${category} source identity`);
      keys.add(entry.key);
      retained.push({ category, key: entry.key, value: entry.value, sha256: digest(canonical(entry.value)) });
    }
    inventory[category] = records[category].length;
  }
  const manifest = { schema: SCHEMA, workspace, chatResetPolicy, paths: Object.fromEntries(
    TREE_CATEGORIES.map(category => [category, path.resolve(trees[category])])), inventory, files, records: retained };
  const content = canonical(manifest), id = digest(content);
  await writeOnce(path.join(destination, "manifest.json"), content);
  await writeOnce(path.join(destination, "manifest.sha256"), id + "\n");
  return { id, inventory };
}

export function classifyJob(job, manualLinks) {
  if (manualLinks.some(link => link.childId === job.id) || job.declarationKey?.startsWith("neural-labs-manual:")) return "manual-helper";
  if (["heartbeat", "skillCollectionReview", "systemEvent"].includes(job.payload?.kind)
      || /^(heartbeat:|heartbeat-task:|skill-collection-review:)/.test(job.declarationKey ?? "")) return "system";
  if (job.payload?.kind === "agentTurn") return "automation";
  return "unsupported";
}

export function jobHold(job, classification) {
  // Import never makes an account mapping or policy assumption. Preserve the
  // original enabled flag and surface holds until explicitly reviewed.
  if (classification !== "automation") return `${classification}-requires-review`;
  if (!["at", "every", "cron", "process", "stream"].includes(job.schedule?.kind)) return "unsupported-trigger";
  if (job.state?.runningAtMs) return "uncertain-legacy-run";
  if (!job.connection) return "native-connection-required";
  return "execution-policy-review-required";
}

function validateManifest(manifest, expectedWorkspace) {
  if (manifest.schema !== SCHEMA || manifest.workspace !== expectedWorkspace) throw new Error("Preservation workspace or schema does not match");
  identity(expectedWorkspace);
  if (!Array.isArray(manifest.files) || !Array.isArray(manifest.records)) throw new Error("Invalid preservation manifest");
  if (!["preserve", "reset-team-pilot", "separately-authorized-reset"].includes(manifest.chatResetPolicy)
      || TREE_CATEGORIES.some(category => typeof manifest.paths?.[category] !== "string" || !path.isAbsolute(manifest.paths[category]))) {
    throw new Error("Preservation paths and chat policy must be explicit");
  }
  const seen = new Set();
  for (const row of manifest.files) {
    if (!TREE_CATEGORIES.includes(row.category) || !["file", "directory"].includes(row.type)
        || !Number.isInteger(row.mode) || row.mode < 0 || row.mode > 0o777) throw new Error("Invalid preserved file");
    relative(row.path);
    const key = row.category + "/" + row.path;
    if (seen.has(key)) throw new Error("Duplicate preserved path");
    seen.add(key);
    if (row.type === "file") {
      hash(row.sha256);
      if (!Number.isSafeInteger(row.size) || row.size < 0) throw new Error("Invalid preserved file size");
    }
  }
  seen.clear();
  for (const row of manifest.records) {
    if (!RECORD_CATEGORIES.includes(row.category) || typeof row.key !== "string" || !row.key
        || row.sha256 !== digest(canonical(row.value))) throw new Error("Invalid preserved record");
    const key = canonical([row.category, row.key]);
    if (seen.has(key)) throw new Error("Duplicate preserved record");
    seen.add(key);
  }
  const actual = {};
  for (const category of TREE_CATEGORIES) {
    const rows = manifest.files.filter(row => row.category === category);
    actual[category] = { files: rows.filter(row => row.type === "file").length,
      directories: rows.filter(row => row.type === "directory").length,
      packages: rows.filter(row => row.type === "directory" && !row.path.includes("/")).length };
  }
  for (const category of RECORD_CATEGORIES) actual[category] = manifest.records.filter(row => row.category === category).length;
  if (canonical(actual) !== canonical(manifest.inventory)) throw new Error("Preservation counts do not match");
}

export async function importPreservation({ source, destination, state, workspace, expectedId }) {
  hash(expectedId);
  await directory(source);
  await directory(path.join(source, "blobs"));
  const raw = (await regularFile(path.join(source, "manifest.json"))).data;
  if (digest(raw) !== expectedId) throw new Error("Preservation manifest digest does not match");
  const manifest = JSON.parse(raw);
  validateManifest(manifest, workspace);
  if (state.metadata("scheduling") !== "disabled" || state.metadata("delivery") !== "disabled") throw new Error("Import requires scheduling and delivery disabled");
  const migration = state.db.prepare("SELECT * FROM migrations WHERE id=?").get(expectedId);
  if (migration && (migration.workspace !== workspace || migration.manifest !== raw.toString())) throw new Error("Migration journal identity conflicts");
  const bound = state.metadata("workspace");
  if (bound && bound !== workspace) throw new Error("Native state is bound to another workspace");
  // Validate *all* blobs before mutating the destination or creating a journal.
  for (const file of manifest.files.filter(row => row.type === "file")) {
    const { data } = await regularFile(path.join(source, "blobs", file.sha256));
    if (data.length !== file.size || digest(data) !== file.sha256) throw new Error("Preserved package hash does not match");
  }
  try { await mkdir(destination, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
  await directory(destination);
  if (!migration) {
    state.transaction(() => {
      if (state.db.prepare("SELECT 1 FROM migrations").get()) throw new Error("Another source migration already owns this native state");
      state.setMetadata("workspace", workspace);
      state.db.prepare("INSERT INTO migrations VALUES (?,?,?,'copying','{}')").run(expectedId, workspace, raw.toString());
    });
  }
  // Resume incomplete file copies without ever overwriting a different file.
  // The archive retains original paths and modes as metadata; activation must
  // supply a reviewed mount/path map instead of rewriting live package paths.
  for (const category of TREE_CATEGORIES) await mkdirBelow(destination, category);
  for (const row of manifest.files) {
    const targetRelative = row.category + "/" + row.path;
    if (row.type === "directory") await mkdirBelow(destination, targetRelative);
    else {
      await mkdirBelow(destination, path.posix.dirname(targetRelative));
      const target = child(destination, targetRelative);
      await writeOnce(target, (await regularFile(path.join(source, "blobs", row.sha256))).data);
      // Private migration archives may contain prompts and ownership metadata.
      // Original permissions are recorded, never broaden archive permissions.
      await chmod(target, 0o600);
    }
  }
  // A pre-existing or modified archive must not smuggle extra package files
  // into an otherwise matching manifest. Keep conflicts for operator review.
  const expectedPaths = new Set(manifest.files.map(row => row.category + "/" + row.path));
  async function checkEntries(category, prefix = "") {
    for (const entry of await readdir(child(destination, category + (prefix ? "/" + prefix : "")), { withFileTypes: true })) {
      const relativeName = (prefix ? prefix + "/" : "") + entry.name;
      if (!expectedPaths.has(category + "/" + relativeName)) throw new Error("Unexpected retained file; archive requires review");
      if (entry.isDirectory()) await checkEntries(category, relativeName);
      else if (!entry.isFile()) throw new Error("Unsupported retained filesystem entry");
    }
  }
  for (const category of TREE_CATEGORIES) await checkEntries(category);
  const manualLinks = manifest.records.filter(row => row.category === "scratch").map(row => row.value);
  const dispositions = {};
  const report = { id: expectedId, workspace, inventory: manifest.inventory, chatResetPolicy: manifest.chatResetPolicy,
    preservationVerified: true, scheduling: "disabled", delivery: "disabled", activationReady: false };
  state.transaction(() => {
    for (const row of manifest.records) {
      let disposition = row.category.startsWith("notification_") || row.category === "automation_subscriptions"
        ? "retained-control-plane-evidence" : "retained-native-history";
      if (row.category === "jobs") {
        const classification = classifyJob(row.value, manualLinks);
        const existing = state.job(row.value.id);
        if (existing && (existing.source_hash !== row.sha256 || existing.migration !== expectedId)) throw new Error("Automation definition or identity conflicts");
        if (!existing) state.putJob(row.value, { classification, hold: jobHold(row.value, classification), migration: expectedId });
        disposition = `native-job:${classification}`;
      }
      const existing = state.db.prepare("SELECT sha256 FROM retained_records WHERE migration=? AND category=? AND source_key=?").get(expectedId, row.category, row.key);
      if (existing && existing.sha256 !== row.sha256) throw new Error("Retained record conflicts");
      state.db.prepare("INSERT OR IGNORE INTO retained_records VALUES (?,?,?,?,?,?)")
        .run(expectedId, row.category, row.key, canonical(row.value), row.sha256, disposition);
      dispositions[disposition] = (dispositions[disposition] || 0) + 1;
    }
    report.dispositions = dispositions;
    const count = state.db.prepare("SELECT count(*) AS count FROM retained_records WHERE migration=?").get(expectedId).count;
    if (count !== manifest.records.length) throw new Error("Retained record count does not match");
    report.heldJobs = state.db.prepare("SELECT id,enabled,hold,classification,completed FROM jobs WHERE migration=? ORDER BY id").all(expectedId);
    state.db.prepare("UPDATE migrations SET phase='verified',report=? WHERE id=?").run(canonical(report), expectedId);
  });
  return report;
}
