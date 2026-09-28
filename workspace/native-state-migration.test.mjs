import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateNativeState } from "./native-state-migration.mjs";

test("native migration runs once for each release before admission", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-migration-"));
  const calls = [];
  const run = async (args, options) => { calls.push({ args, options }); return { status: 0 }; };
  try {
    assert.equal(await migrateNativeState({ root, version: "2026.9.6", run }), true);
    assert.equal(await migrateNativeState({ root, version: "2026.9.6", run }), false);
    assert.deepEqual(calls, [{ args: ["doctor", "--fix", "--non-interactive"], options: { quiet: true } }]);
    assert.equal(await migrateNativeState({ root, version: "2026.9.7", run }), true);
    assert.equal(calls.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("failed or interrupted native migrations cannot record success or expose CLI output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-migration-"));
  try {
    for (const run of [async () => ({ status: 1, stderr: "private credential" }), async () => { throw new Error("private credential"); }]) {
      await assert.rejects(migrateNativeState({ root, version: "2026.9.6", run }), error =>
        /keep the workspace gated/.test(error.message) && !error.message.includes("private credential"));
      await assert.rejects(readFile(path.join(root, "native-state-release.json")), { code: "ENOENT" });
    }
    await writeFile(path.join(root, "native-state-release.json"), "incomplete");
    await assert.rejects(migrateNativeState({ root, version: "2026.9.6", run: async () => assert.fail("must not run") }), /receipt is unreadable/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
