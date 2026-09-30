// Operator-only image acceptance with generated state. No account sign-in,
// provider inference, external delivery, production mounts, or host changes.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
const base = "/usr/local/lib/neural-labs/native";
const { createNativeLauncher, prepareNativeHome, NATIVE_HOME, NATIVE_WORKSPACE } = await import(`${base}/launcher.mjs`);
const { StdioRpc, CODEX_APP_SERVER, providerEnvironment } = await import(`${base}/codex.mjs`);
const { NativeEditors } = await import(`${base}/editors.mjs`);
const { NativeSkills } = await import(`${base}/skills.mjs`);
const { nativeModelCatalog } = await import(`${base}/models.mjs`);
const { createSkillsManager, workspaceSkillActorId } = await import(`${base}/../skills-manager.mjs`);
const root = await mkdtemp("/tmp/native-image-");
const workspaceRoot = path.join(root, "workspace"), homeRoot = path.join(root, "account");
await mkdir(workspaceRoot); await prepareNativeHome(homeRoot);
const manager = createSkillsManager({ personalRoot: path.join(root, "personal-skills"), teamRoot: path.join(workspaceRoot, "skills") });
await manager.save({ id: workspaceSkillActorId("fixture"), displayName: "Fixture", role: "user" },
  { name: "native-fixture", description: "Only for the explicit native discovery acceptance check", instructions: "Report the generated fixture result.", scope: "personal" });
const skills = new NativeSkills({ manager, root: path.join(root, "discovery") });
const prepared = await skills.prepare({ actor: "fixture", provider: "codex", input: [{ type: "text", text: "$native-fixture" }] });
const launch = await createNativeLauncher({ workspaceRoot, homeRoot, extraReadOnly: prepared.mounts, skillDiscoveryRoot: prepared.discovery });
const env = providerEnvironment({ provider: "codex", home: NATIVE_HOME, credentialHome: `${NATIVE_HOME}/.codex`, method: "subscription" });
let rpc, editors;
try {
  const original = "Synthetic original file version", current = "Synthetic newer working copy";
  const checksum = createHash("sha256").update(original).digest("hex");
  await mkdir(path.join(workspaceRoot, ".alshival-import"));
  await writeFile(path.join(workspaceRoot, ".alshival-import", checksum), original);
  await writeFile(path.join(workspaceRoot, "history-check.txt"), current);
  const history = { format: 1, workspace: randomUUID(), files: [{ id: randomUUID(), path: "history-check.txt",
    versions: [{ id: randomUUID(), version: 1, name: "history-check.txt", size: Buffer.byteLength(original),
      sha256: checksum, created_at: "2026-01-01T00:00:00Z" }] }], folders: [] };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = execFileSync(process.execPath, [`${base}/../import-history.mjs`], {
      input: JSON.stringify(history), encoding: "utf8", timeout: 10000,
      env: { PATH: "/usr/local/bin:/usr/bin:/bin", NEURAL_LABS_WORKSPACE_ROOT: workspaceRoot },
    });
    assert.equal(JSON.parse(result).imported, true);
  }
  assert.equal(await readFile(path.join(workspaceRoot, "history-check.txt"), "utf8"), current);
  assert.equal(await readFile(path.join(root, ".local/state/neural-labs/files/history", checksum), "utf8"), original);
  console.log("Packaged history entrypoint, native workspace binding, verified import, retry, and working-copy preservation passed");

  await launch.probe();
  rpc = new StdioRpc(CODEX_APP_SERVER, ["app-server", "-c", 'forced_login_method="chatgpt"',
    "-c", 'mcp_servers.neural-labs.url="http://127.0.0.1:8792/mcp"',
    "-c", 'mcp_servers.neural-labs.http_headers={"Authorization"="Bearer synthetic"}'],
  { cwd: NATIVE_WORKSPACE, env, spawnProcess: launch.spawn, requestTimeoutMs: 10000 });
  const initialized = await rpc.request("initialize", { clientInfo: { name: "neural_labs_probe", version: "1" } });
  assert.ok(initialized);
  rpc.send({ method: "initialized" });
  assert.ok(Array.isArray((await rpc.request("thread/list", { limit: 1 })).data));
  const catalog = await rpc.request("skills/list", { cwds: [NATIVE_WORKSPACE], forceReload: true });
  assert.ok(catalog.data.some(row => row.skills.some(skill => skill.name === "native-fixture" && skill.enabled)), "Codex must discover the isolated canonical skill package");
  const readable = await launch.exec("/bin/sh", ["-c", "cat /home/node/.claude/skills/native-fixture/SKILL.md; test ! -w /home/node/.claude/skills/native-fixture/SKILL.md"],
    { env, timeout: 10000 });
  assert.match(readable.stdout, /Report the generated fixture result/);
  await rpc.close(); rpc = null;
  console.log("Codex initialization, thread-list, skill discovery, and read-only Claude skill view passed; no inference");

  for (const provider of ["codex", "claude"]) {
    const catalog = await nativeModelCatalog({ connection: "fixture", binding: { provider, method: "subscription" }, home: NATIVE_HOME,
      credentialHome: `${NATIVE_HOME}/${provider === "codex" ? ".codex" : ".claude"}`, cwd: NATIVE_WORKSPACE,
      launch, revalidate: async () => {} }, { ready: false });
    assert.ok(catalog.models.length > 0);
    assert.ok(catalog.models.every(row => row.provider === provider && row.available === false));
    console.log(`${provider} native model catalog passed without sign-in or inference`);
  }

  let authorized = true, now = Date.now();
  editors = new NativeEditors({ root: path.join(root, "editors"), now: () => now, idleMs: 1000,
    interactive: { runtime: { turns: { gated: false } }, context: async ({ editorSocketRoot }) => ({
      revalidate: async () => { if (!authorized) throw new Error("revoked"); },
      launch: await createNativeLauncher({ workspaceRoot, homeRoot, editorSocketRoot }),
    }) } });
  const request = { headers: { "x-forwarded-user": "fixture", "x-neural-labs-session": "a".repeat(43) } };
  const first = await editors.ensure(request);
  const release = first.acquire(); now += 2000; await editors.maintain();
  assert.equal(editors.editors.size, 1, "connected editor must remain running");
  release(); now += 2000; await editors.maintain(); assert.equal(editors.editors.size, 0);
  await editors.ensure(request); assert.equal(editors.editors.size, 1);
  authorized = false; await editors.maintain(); assert.equal(editors.editors.size, 0);
  console.log("Private editor socket, idle release, restart, and membership revocation passed");

  const browser = await launch.exec("/usr/bin/chromium", ["--headless", "--disable-gpu", "--no-first-run",
    "--disable-background-networking", "--dump-dom", "data:text/html,<title>native-fixture</title><p>browser-ready</p>"],
  { cwd: NATIVE_WORKSPACE, env: { HOME: NATIVE_HOME, PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" }, timeout: 30000, maxBuffer: 1024 * 1024 });
  assert.match(browser.stdout, /browser-ready/);
  console.log("Chromium headless workspace execution passed with its sandbox enabled");
} finally {
  await rpc?.close(); await editors?.close(); await prepared.release(); await rm(root, { recursive: true, force: true });
}
