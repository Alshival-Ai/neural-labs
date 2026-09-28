import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, symlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createImportedHistory } from "./imported-history.mjs";

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), "nl-history-test-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "workspace");
  const stateRoot = path.join(base, "history");
  await mkdir(path.join(root, ".alshival-import"), { recursive: true });
  const bytes = Buffer.from("original fixture version");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(path.join(root, ".alshival-import", sha256), bytes);
  const manifest = { format: 1, workspace: randomUUID(), folders: [], files: [{ id: randomUUID(), name: "notes.txt",
    path: "notes.txt", trashed_at: null, agent_modified: true,
    versions: [{ id: randomUUID(), version: 1, name: "notes.txt", sha256, size: bytes.length, created_at: "2026-01-01T00:00:00Z" }] }] };
  return { base, root, stateRoot, manifest, bytes, sha256, history: createImportedHistory({ root, stateRoot }) };
}

test("resumes verified imports without replacing working files and serves original versions", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, "notes.txt"), "agent's newer edit");
  assert.equal((await f.history.import(f.manifest)).imported, true);
  const restarted = createImportedHistory(f);
  assert.equal((await restarted.import(f.manifest)).versions, 1);
  const file = await restarted.download(f.manifest.files[0].versions[0].id);
  const chunks = [];
  for await (const chunk of file.stream()) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), f.bytes);
  assert.equal((await restarted.list("notes.txt")).files[0].agent_modified, true);
  assert.equal((await restarted.list("other.txt")).files.length, 0);
});

test("rejects missing, changed and symlinked staged bytes before publishing a manifest", async t => {
  const f = await fixture(t);
  const staged = path.join(f.root, ".alshival-import", f.sha256);
  await writeFile(staged, "wrong bytes");
  await assert.rejects(f.history.import(f.manifest));
  assert.deepEqual((await f.history.list()).files, []);
  await rm(staged);
  await writeFile(path.join(f.base, "private"), f.bytes);
  await symlink(path.join(f.base, "private"), staged);
  await assert.rejects(f.history.import(f.manifest));
  assert.deepEqual((await f.history.list()).files, []);
});

test("refuses replacing or dropping an imported version and detects archive tampering", async t => {
  const f = await fixture(t);
  await f.history.import(f.manifest);
  await assert.rejects(f.history.import({ ...f.manifest, files: [] }));
  const changed = structuredClone(f.manifest);
  changed.files[0].versions[0].name = "different.txt";
  await assert.rejects(f.history.import(changed));
  const archived = path.join(f.stateRoot, f.sha256);
  await chmod(archived, 0o600);
  await writeFile(archived, Buffer.alloc(f.bytes.length));
  await assert.rejects(f.history.download(f.manifest.files[0].versions[0].id));
});

test("retains Trash metadata and rejects cross-workspace or traversing manifests", async t => {
  const f = await fixture(t);
  f.manifest.files[0].trashed_at = "2026-01-02T00:00:00Z";
  await f.history.import(f.manifest);
  assert.equal((await f.history.list()).files[0].trashed_at, "2026-01-02T00:00:00Z");
  await assert.rejects(f.history.import({ ...f.manifest, workspace: randomUUID() }));
  f.manifest.files[0].path = "../private";
  await assert.rejects(f.history.import(f.manifest));
});
