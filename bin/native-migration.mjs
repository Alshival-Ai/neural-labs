#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NativeState } from "../workspace/native/state.mjs";
import { exportPreservation, importPreservation } from "../workspace/native/migration.mjs";
import { readLegacyScheduler } from "../workspace/native/legacy-sqlite.mjs";

const [command, ...argv] = process.argv.slice(2);
const options = {};
function required(key) {
  if (typeof options[key] !== "string" || !options[key]) throw new Error(`Missing --${key}`);
  return options[key];
}
try {
  for (let index = 0; index < argv.length; index += 2) {
    if (!/^--[a-z-]+$/.test(argv[index]) || !argv[index + 1] || argv[index + 1].startsWith("--") || Object.hasOwn(options, argv[index].slice(2))) throw new Error("Expected unique --name value arguments");
    options[argv[index].slice(2)] = argv[index + 1];
  }
  if (command === "inventory") {
    const { counts } = readLegacyScheduler(path.resolve(required("legacy-db")));
    console.log(JSON.stringify({ counts, readOnly: true, cutoverSnapshot: false }));
  } else if (command === "export") {
    const config = JSON.parse(await readFile(path.resolve(required("config")), "utf8"));
    const records = JSON.parse(await readFile(config.recordsSnapshot, "utf8"));
    if (config.legacyDatabase) {
      const { counts, ...legacy } = readLegacyScheduler(config.legacyDatabase);
      for (const [category, entries] of Object.entries(legacy)) {
        if (Object.hasOwn(records, category)) throw new Error(`Snapshot already contains ${category}; do not overwrite source records`);
        records[category] = entries;
      }
    }
    console.log(JSON.stringify(await exportPreservation({ workspace: config.workspace, trees: config.trees,
      chatResetPolicy: config.chatResetPolicy, records, destination: path.resolve(required("destination")) })));
  } else if (command === "import") {
    // Import is only a private archive/native-state operation. It cannot enable
    // scheduling, send external deliveries, reset chats or replace live paths.
    const source = path.resolve(required("source")), db = path.resolve(required("database"));
    const destination = path.resolve(required("destination"));
    for (const candidate of [db, destination]) {
      const relative = path.relative(source, candidate);
      if (!relative || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Import cannot write inside its source bundle");
    }
    const state = new NativeState(db);
    try { console.log(JSON.stringify(await importPreservation({ source, destination, state,
      workspace: required("workspace"), expectedId: required("sha256") }))); }
    finally { state.close(); }
  } else {
    throw new Error("Usage: native-migration.mjs inventory --legacy-db PATH | export --config PATH --destination NEW_PATH | import --source PATH --destination PATH --database PATH --workspace ID --sha256 HASH");
  }
} catch (error) {
  // JSON/parser/database errors can contain source data. Emit only our bounded
  // operational errors; retain full source in the private bundle, never logs.
  const safe = /^(Missing --|Expected unique|Snapshot already|Import cannot|Usage:|Unsupported legacy schema:)/.test(error.message);
  console.error(safe ? error.message : "Native preservation failed; source data is unchanged and activation remains disabled.");
  process.exitCode = 1;
}
