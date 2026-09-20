import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareVersions, pinnedCodex, terminalCodexSelection, updateTerminalCodex } from "./codex-updates.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "codex-updates-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseVersion = "0.155.1";
  const run = async (command, args, options) => {
    assert.equal(options.env.OPENAI_API_KEY, undefined);
    assert.equal(options.env.NEURAL_LABS_TWILIO_AUTH_TOKEN, undefined);
    assert.equal(options.env.NPM_CONFIG_USERCONFIG, path.join(options.cwd, "empty-user.npmrc"));
    assert.equal(options.env.NPM_CONFIG_GLOBALCONFIG, path.join(options.cwd, "empty-global.npmrc"));
    if (command.endsWith("/npm")) {
      assert.ok(args.includes("--ignore-scripts"));
      assert.ok(args.includes("--registry=https://registry.npmjs.org"));
      const dir = path.join(options.cwd, "node_modules/@openai/codex/bin");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "codex.js"), "// synthetic executable");
      return { stdout: "" };
    }
    return { stdout: "codex-cli 0.156.0\n" };
  };
  return { root, baseVersion, run, fetchRelease: async () => ({ name: "@openai/codex", version: "0.156.0" }) };
}

test("a verified stable update activates atomically, retains fallback, and checks at most daily", async (t) => {
  const options = await fixture(t);
  assert.deepEqual(await updateTerminalCodex(options), { status: "updated", version: "0.156.0" });
  assert.equal(await readlink(path.join(options.root, "current")), "versions/0.156.0");
  assert.equal(terminalCodexSelection({ ...options, enabled: true }).version, "0.156.0");
  assert.equal(terminalCodexSelection({ ...options, enabled: false }).version, "0.156.0");
  assert.equal((await updateTerminalCodex({ ...options, fetchRelease: () => assert.fail("not due") })).status, "not-due");
  assert.equal(terminalCodexSelection({ ...options, baseVersion: "0.157.0", enabled: true }).command, pinnedCodex);
});

test("failed downloads and mismatched executables preserve the previous selection", async (t) => {
  const options = await fixture(t);
  await updateTerminalCodex(options);
  const next = { ...options, force: true, fetchRelease: async () => ({ name: "@openai/codex", version: "0.157.0" }) };
  await assert.rejects(updateTerminalCodex(next), /version verification failed/);
  assert.equal(terminalCodexSelection({ ...options, enabled: true }).version, "0.156.0");
  await assert.rejects(updateTerminalCodex({ ...next, run: async () => { throw new Error("download failed"); } }), /download failed/);
  assert.equal(terminalCodexSelection({ ...options, enabled: true }).version, "0.156.0");
});

test("prereleases and downgrades cannot activate; concurrent updates are excluded", async (t) => {
  const options = await fixture(t);
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  await assert.rejects(updateTerminalCodex({ ...options, fetchRelease: async () => ({ name: "@openai/codex", version: "0.156.0-alpha.1" }) }), /Invalid stable/);
  assert.equal((await updateTerminalCodex({ ...options, force: true, fetchRelease: async () => ({ name: "@openai/codex", version: "0.154.0" }) })).status, "current");
  await mkdir(path.join(options.root, ".update-lock"));
  assert.equal((await updateTerminalCodex({ ...options, force: true })).status, "busy");
});

test("saved policy changes take effect without restart and unavailable policy fails closed", async t => {
  const { startTerminalCodexUpdates } = await import("./codex-updates.mjs");
  const fixtureOptions = await fixture(t);
  let allowed = false, unavailable = false, count = 0, firstReport;
  const initial = new Promise(resolve => { firstReport = resolve; });
  const reports = [];
  const worker = startTerminalCodexUpdates({ ...fixtureOptions, enabled: true, log: () => {},
    policy: async () => { if (unavailable) throw new Error("offline"); return { policy: { codexAutomatic: allowed } }; },
    update: async () => { count++; return { status: "current" }; },
    report: async status => { reports.push(status); firstReport(); },
  });
  t.after(() => worker.close());
  await initial; assert.equal(count, 0); assert.equal(reports.at(-1).result, "disabled");
  await new Promise(resolve => setImmediate(resolve));
  allowed = true; await worker.check(); assert.equal(count, 1);
  unavailable = true; await worker.check(); assert.equal(count, 1); assert.equal(reports.at(-1).result, "failed");
  unavailable = false; allowed = false; await worker.check(); assert.equal(count, 1); assert.equal(reports.at(-1).result, "disabled");
});
