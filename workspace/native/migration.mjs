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
      state.setMetadata("installation", "migration");
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

// Operator-only, while both old and candidate writers are stopped. The path map
// is explicit because a retained archive is not a usable installed library.
// Never rewrite an original package to make it compatible with a provider.
export async function projectPreservation({ state, workspace, expectedId, source, targets }) {
  hash(expectedId);
  const migration = state.db.prepare("SELECT * FROM migrations WHERE id=?").get(expectedId);
  if (!migration || migration.workspace !== workspace || migration.phase !== "verified"
      || state.metadata("scheduling") !== "disabled" || state.metadata("delivery") !== "disabled"
      || state.metadata("activation")) throw new Error("Projection requires a verified, inactive migration");
  const manifest = JSON.parse(migration.manifest);
  validateManifest(manifest, workspace);
  if (digest(migration.manifest) !== expectedId || canonical(Object.keys(targets).sort()) !== canonical([...TREE_CATEGORIES].sort()))
    throw new Error("Projection requires the complete reviewed path map");
  const map = {};
  for (const category of TREE_CATEGORIES) {
    const target = targets[category];
    if (typeof target !== "string" || !path.isAbsolute(target) || path.resolve(target) !== target || target === "/")
      throw new Error("Projection targets must be canonical absolute directories");
    await directory(target);
    map[category] = target;
  }
  // Overlapping category roots would make independent integrity checks ambiguous.
  const roots = Object.values(map);
  if (roots.some((a, i) => roots.some((b, j) => i !== j && (a === b || b.startsWith(a + path.sep)))))
    throw new Error("Projection roots must not overlap");
  await directory(source); await directory(path.join(source, "blobs"));
  if (digest((await regularFile(path.join(source, "manifest.json"))).data) !== expectedId)
    throw new Error("Projection source does not match the migration");
  const previous = state.metadata("projection");
  const receipt = canonical({ migration: expectedId, workspace, targets: map });
  if (previous && previous !== receipt) throw new Error("Projection paths changed during recovery");
  state.setMetadata("projection", receipt);
  for (const row of manifest.files) {
    const root = map[row.category], target = child(root, row.path);
    if (row.type === "directory") await mkdirBelow(root, row.path);
    else {
      const parent = path.posix.dirname(row.path);
      if (parent !== ".") await mkdirBelow(root, parent);
      const { data } = await regularFile(path.join(source, "blobs", row.sha256));
      if (data.length !== row.size || digest(data) !== row.sha256) throw new Error("Projection source file failed its integrity check");
      await writeOnce(target, data);
      await chmod(target, row.mode);
    }
  }
  // Apply directory modes after writing children. Read-only package directories
  // are valid; their original permissions must survive the projection too.
  for (const row of manifest.files.filter(row => row.type === "directory").reverse())
    await chmod(child(map[row.category], row.path), row.mode);
  return verifyProjection({ state, workspace, expectedId });
}

export async function verifyProjection({ state, workspace, expectedId }) {
  hash(expectedId);
  const migration = state.db.prepare("SELECT * FROM migrations WHERE id=?").get(expectedId);
  if (!migration || migration.workspace !== workspace || migration.phase !== "verified" || digest(migration.manifest) !== expectedId)
    throw new Error("A verified matching migration is required");
  const manifest = JSON.parse(migration.manifest);
  validateManifest(manifest, workspace);
  const projection = JSON.parse(state.metadata("projection") || "null");
  if (projection?.migration !== expectedId || projection.workspace !== workspace
      || canonical(Object.keys(projection.targets).sort()) !== canonical([...TREE_CATEGORIES].sort()))
    throw new Error("The installed path map has not been reviewed");
  const expected = new Map(manifest.files.map(row => [row.category + "/" + row.path, row]));
  let verified = 0;
  for (const category of TREE_CATEGORIES) {
    const root = projection.targets[category];
    await directory(root);
    async function visit(prefix = "") {
      for (const entry of await readdir(prefix ? child(root, prefix) : root, { withFileTypes: true })) {
        const name = prefix ? prefix + "/" + entry.name : entry.name;
        const row = expected.get(category + "/" + name);
        if (!row) throw new Error("Installed package contains an uninventoried entry");
        const filename = child(root, name), info = await lstat(filename);
        if ((info.mode & 0o777) !== row.mode || info.isSymbolicLink()) throw new Error("Installed package permissions or type changed");
        if (row.type === "directory") {
          if (!info.isDirectory()) throw new Error("Installed package type changed");
          await visit(name);
        } else {
          const { data } = await regularFile(filename);
          if (data.length !== row.size || digest(data) !== row.sha256) throw new Error("Installed package hash changed");
        }
        verified++;
      }
    }
    await visit();
  }
  if (verified !== manifest.files.length) throw new Error("Installed package entries are missing");
  const retained = state.db.prepare("SELECT * FROM retained_records WHERE migration=?").all(expectedId);
  if (retained.length !== manifest.records.length) throw new Error("Retained record count changed");
  const rows = new Map(retained.map(row => [canonical([row.category, row.source_key]), row]));
  const manualLinks = manifest.records.filter(row => row.category === "scratch").map(row => row.value);
  for (const source of manifest.records) {
    const row = rows.get(canonical([source.category, source.key]));
    if (!row || row.sha256 !== source.sha256 || digest(canonical(JSON.parse(row.payload))) !== source.sha256)
      throw new Error("Retained record integrity changed");
    if (source.category === "jobs") {
      const job = state.job(source.value.id);
      const classification = classifyJob(source.value, manualLinks);
      const completed = source.value.schedule?.kind === "at" && Boolean(source.value.state?.lastRunAtMs);
      if (!job || job.migration !== expectedId || job.source_hash !== source.sha256
          || canonical(job.definition) !== canonical(source.value) || job.enabled !== source.value.enabled
          || job.completed !== completed || job.classification !== classification || job.hold !== jobHold(source.value, classification))
        throw new Error("Imported automation changed before policy review");
    }
  }
  return { migration: expectedId, workspace, filesVerified: verified, recordsVerified: retained.length,
    targets: projection.targets, inventory: manifest.inventory, scheduling: state.metadata("scheduling"),
    delivery: state.metadata("delivery"), activationReady: false };
}

// Admit the imported workspace only after the host has stopped the old scheduler,
// projected every package and obtained the control plane's explicit reset receipt.
// This does not clear any job hold, enable scheduling, or send old notifications.
export async function activatePreservation({ state, workspace, expectedId, controlPlaneRecords, chatReceipt,
  afterCommit = { scheduling: "disabled", delivery: "disabled" } }) {
  if (canonical(Object.keys(afterCommit).sort()) !== canonical(["delivery", "scheduling"])
      || Object.values(afterCommit).some(value => !["enabled", "disabled"].includes(value)))
    throw new Error("An explicit post-commit execution policy is required");
  if (state.metadata("scheduling") !== "disabled" || state.metadata("delivery") !== "disabled")
    throw new Error("Activation requires scheduling and delivery disabled");
  const projected = await verifyProjection({ state, workspace, expectedId });
  const migration = state.db.prepare("SELECT * FROM migrations WHERE id=?").get(expectedId);
  const manifest = JSON.parse(migration.manifest);
  if (chatReceipt?.workspace !== workspace || chatReceipt.migration !== expectedId
      || chatReceipt.chatResetPolicy !== manifest.chatResetPolicy
      || !["preserve", "reset-team-pilot", "separately-authorized-reset"].includes(manifest.chatResetPolicy)
      || manifest.chatResetPolicy === "preserve" && chatReceipt.channelsRemoved !== 0
      || !Number.isSafeInteger(chatReceipt.channelsRemoved) || chatReceipt.channelsRemoved < 0)
    throw new Error("A matching control-plane chat-reset receipt is required");
  if (state.db.prepare("SELECT 1 FROM conversations LIMIT 1").get()
      || state.db.prepare("SELECT 1 FROM occurrences LIMIT 1").get())
    throw new Error("Native work was already accepted; use forward recovery");
  const tables = RECORD_CATEGORIES.filter(category => category.startsWith("notification_") || category === "automation_subscriptions");
  const verified = {};
  for (const category of [...tables, "ownership"]) {
    const current = controlPlaneRecords?.[category];
    if (!Array.isArray(current)) throw new Error("Complete live control-plane evidence is required");
    const original = manifest.records.filter(row => row.category === category).map(row => row.value);
    const hashes = rows => rows.map(row => digest(canonical(row))).sort();
    const expected = original.map(row => category === "notification_preferences" && manifest.chatResetPolicy !== "preserve" ? { ...row, session_key: null } : row);
    const live = hashes(current.map(row => row.value));
    if (canonical(live) !== canonical(hashes(expected))) throw new Error("Control-plane preservation comparison failed");
    if (tables.includes(category)) verified[category] = live;
  }
  if (digest(canonical(verified)) !== chatReceipt.notificationState) throw new Error("Control-plane receipt does not match current notification state");
  const receipt = canonical({ migration: expectedId, workspace, projection: JSON.parse(state.metadata("projection")), chatReceipt, afterCommit });
  const existing = state.metadata("activationReceipt");
  if (existing && existing !== receipt) throw new Error("Activation evidence changed; use forward recovery");
  state.transaction(() => {
    state.setMetadata("activationReceipt", receipt);
    state.setMetadata("activation", "verified");
    // Scheduling remains disabled in probation. Only the host's durable commit
    // and subsequent maintenance resume may apply this reviewed policy.
    state.setMetadata("maintenance", canonical(afterCommit));
  });
  return { ...projected, activationReady: true, jobsHeld: state.db.prepare("SELECT count(*) AS count FROM jobs WHERE hold IS NOT NULL").get().count };
}
