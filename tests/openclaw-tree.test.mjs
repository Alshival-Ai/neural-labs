import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, symlink, chmod, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fingerprintTree } from "./openclaw-tree.mjs";

test("image comparison detects content, extra files, permissions and launcher changes", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "openclaw-tree-"));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const file = path.join(dir, "runtime.js");
  await writeFile(file, "upstream");
  await chmod(file, 0o644);
  const base = await fingerprintTree(dir);
  await utimes(file, new Date(0), new Date(0));
  assert.deepEqual(await fingerprintTree(dir), base);
  await writeFile(file, "modified");
  assert.notDeepEqual(await fingerprintTree(dir), base);
  await writeFile(file, "upstream");
  await chmod(file, 0o755);
  assert.notDeepEqual(await fingerprintTree(dir), base);
  await chmod(file, 0o644);
  await symlink("runtime.js", path.join(dir, "codex"));
  const bundled = await fingerprintTree(dir);
  assert.notDeepEqual(bundled, base);
  await rm(path.join(dir, "codex"));
  await symlink("/usr/local/bin/codex", path.join(dir, "codex"));
  assert.notDeepEqual(await fingerprintTree(dir), bundled);
});
