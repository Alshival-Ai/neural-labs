import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createNativeLauncher, prepareNativeHome } from "./native/launcher.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-launcher-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, "workspace"), homeRoot = path.join(root, "private");
  await mkdir(workspaceRoot); await prepareNativeHome(homeRoot);
  return { root, workspaceRoot, homeRoot };
}
test("all provider launch paths isolate credentials and remove runtime secrets", async t => {
  const roots = await fixture(t); const calls = [];
  const launcher = await createNativeLauncher({ ...roots,
    spawnProcess: (...args) => calls.push(args), executeProcess: async (...args) => calls.push(args) });
  const options = { cwd: "/home/node/workspace", env: { HOME: "/home/node", CODEX_HOME: "/home/node/.codex" } };
  launcher.spawn("/usr/local/bin/codex", ["app-server"], options);
  await launcher.exec("/usr/local/bin/codex", ["--version"], options);
  for (const [file, args, launch] of calls) {
    assert.equal(file, "/usr/bin/bwrap");
    assert.ok(args.includes("--unshare-pid")); assert.ok(args.includes("--cap-drop"));
    assert.ok(args.includes(roots.homeRoot)); assert.ok(args.includes(roots.workspaceRoot));
    assert.deepEqual(launch.env, { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" });
    assert.ok(!args.includes("/home")); assert.ok(!args.includes("/etc"));
  }
  assert.throws(() => launcher.invocation("sh", [], options), /command/);
  assert.throws(() => launcher.invocation("/bin/sh", [], { ...options, cwd: "/" }), /working directory/);
});
test("launcher rejects overlapping or symlinked credential roots", async t => {
  const roots = await fixture(t);
  await assert.rejects(createNativeLauncher({ ...roots, homeRoot: roots.workspaceRoot }), /separate/);
  await symlink(roots.homeRoot, path.join(roots.root, "alias"));
  await assert.rejects(createNativeLauncher({ ...roots, homeRoot: path.join(roots.root, "alias") }), /real directories/);
});
test("isolation failure never falls back to an unrestricted provider", async t => {
  const roots = await fixture(t); let calls = 0;
  const launcher = await createNativeLauncher({ ...roots, executeProcess: async () => { calls++; throw new Error("user namespaces unavailable"); } });
  await assert.rejects(launcher.probe(), /namespaces unavailable/); assert.equal(calls, 1);
});
test("preparing an account refuses user-created symlinks before writing outside its home", async t => {
  const roots = await fixture(t);
  const destination = path.join(roots.root, "other-owner"); await mkdir(destination);
  await rm(path.join(roots.homeRoot, ".agents"), { recursive: true });
  await symlink(destination, path.join(roots.homeRoot, ".agents"));
  await assert.rejects(prepareNativeHome(roots.homeRoot));
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual(await readdir(destination), []);
});
