#!/usr/bin/env node
/** Offline, read-only export of retained Projects records. Never runs migrations. */
import { open, mkdir, opendir, lstat, copyFile, chmod } from "node:fs/promises";
import { createReadStream, constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadConfig } from "../control-plane/dist/config.js";
import { createPool } from "../control-plane/dist/pool.js";
const [output, filesRoot] = process.argv.slice(2);
if (!output || !filesRoot) throw new Error("Usage: node bin/export-projects.mjs /private/export-directory /shared-files-directory");
const sourceRoot = path.resolve(filesRoot);
if (path.resolve(output).startsWith(sourceRoot + path.sep)) throw new Error("Export must be outside the source directory");
async function checksum(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function copyAttachments(relative = "", records = []) {
  const source = path.join(sourceRoot, relative), target = path.join(output, "files", relative);
  if ((await lstat(source)).isSymbolicLink()) throw new Error("Attachment export does not follow symbolic links");
  await mkdir(target, { mode: 0o700 });
  for await (const entry of await opendir(source)) {
    const name = path.join(relative, entry.name), file = path.join(sourceRoot, name), destination = path.join(output, "files", name);
    if (entry.isDirectory()) await copyAttachments(name, records);
    else if (entry.isFile()) {
      const before = await lstat(file), digest = await checksum(file);
      await copyFile(file, destination, constants.COPYFILE_EXCL); await chmod(destination, 0o600);
      const after = await lstat(file);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || digest !== await checksum(destination))
        throw new Error("A source file changed during export; retry in a new directory with writers stopped");
      records.push({ path: name, size: before.size, sha256: digest });
    } else throw new Error("Attachment export accepts only regular files and directories");
  }
  return records;
}
await mkdir(output, { mode: 0o700 });
const pool = createPool(await loadConfig()), client = await pool.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const tables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname=current_schema()
    AND tablename LIKE 'project_%' AND tablename NOT LIKE '%token%' AND tablename NOT LIKE '%credential%' AND tablename <> 'project_api_keys'
    ORDER BY tablename`)).rows;
  const manifest = { format: "neural-labs-project-export-v1", created_at: new Date().toISOString(), tables: [], files: [] };
  for (const { tablename } of tables) {
    if (!/^project_[a-z_]+$/.test(tablename)) throw new Error("Unexpected table identity");
    const file = await open(path.join(output, tablename + ".jsonl"), "wx", 0o600);
    const hash = createHash("sha256"); let count = 0;
    try {
      await client.query(`DECLARE project_export NO SCROLL CURSOR FOR SELECT * FROM "${tablename}"`);
      while (true) {
        const rows = (await client.query("FETCH 500 FROM project_export")).rows;
        if (!rows.length) break;
        for (const row of rows) { const line = JSON.stringify(row) + "\n"; hash.update(line); await file.write(line); count++; }
      }
      await client.query("CLOSE project_export"); await file.sync();
    } finally { await file.close(); }
    manifest.tables.push({ name: tablename, count, sha256: hash.digest("hex") });
  }
  const authors = (await client.query(`SELECT id,display_name FROM users WHERE id IN (
    SELECT author_id FROM project_items UNION SELECT actor_id FROM project_events
    UNION SELECT (data->>'assignee')::uuid FROM project_items WHERE data->>'assignee' IS NOT NULL
    UNION SELECT (data->>'reviewer')::uuid FROM project_items WHERE data->>'reviewer' IS NOT NULL)
    ORDER BY id`)).rows;
  const authorsFile = await open(path.join(output, "project_authors.jsonl"), "wx", 0o600), authorsHash = createHash("sha256");
  try {
    for (const author of authors) { const line = JSON.stringify(author) + "\n"; authorsHash.update(line); await authorsFile.write(line); }
    await authorsFile.sync();
  } finally { await authorsFile.close(); }
  manifest.tables.push({ name: "project_authors", count: authors.length, sha256: authorsHash.digest("hex") });
  manifest.files = await copyAttachments();
  await client.query("COMMIT");
  const file = await open(path.join(output, "manifest.json"), "wx", 0o600);
  try { await file.writeFile(JSON.stringify(manifest, null, 2)); await file.sync(); } finally { await file.close(); }
  console.log("Graph and shared-file export written with checksums. Original data was retained.");
} finally { await client.query("ROLLBACK").catch(() => {}); client.release(); await pool.end(); }
