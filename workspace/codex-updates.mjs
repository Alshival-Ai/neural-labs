import { execFile } from "node:child_process";
import { existsSync, readlinkSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
export const terminalCodexRoot = "/home/node/.local/share/neural-labs/codex-terminal";
export const pinnedCodex = "/usr/local/lib/node_modules/@openai/codex/bin/codex.js";
const stable = /^\d+\.\d+\.\d+$/u;
const day = 24 * 60 * 60 * 1000;

export function compareVersions(a, b) {
  if (!stable.test(a) || !stable.test(b)) throw new Error("Expected stable Codex versions");
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}

export function terminalCodexSelection({ root = terminalCodexRoot, baseVersion }) {
  const fallback = { version: baseVersion, command: pinnedCodex };
  try {
    const target = readlinkSync(path.join(root, "current"));
    const match = /^versions\/(\d+\.\d+\.\d+)$/u.exec(target);
    if (!match || compareVersions(match[1], baseVersion) < 0) return fallback;
    const command = path.join(root, target, "node_modules/@openai/codex/bin/codex.js");
    return existsSync(command) ? { version: match[1], command } : fallback;
  } catch { return fallback; }
}

// Downloads are isolated from provider credentials and npm configuration. Only
// the terminal installation is mutable; OpenClaw's app-server is never touched.
export async function updateTerminalCodex({ root = terminalCodexRoot, baseVersion,
  fetchRelease = async () => {
    const response = await fetch("https://registry.npmjs.org/@openai%2fcodex/latest", { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Codex release lookup failed");
    return response.json();
  }, run = execute, now = Date.now(), force = false } = {}) {
  if (!stable.test(baseVersion)) throw new Error("Missing pinned Codex fallback");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, ".update-lock");
  try { await mkdir(lock); } catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Every child command is bounded to five minutes. Recover interrupted runs.
    if (now - (await stat(lock)).mtimeMs < 15 * 60 * 1000) return { status: "busy" };
    await rm(lock, { recursive: true, force: true });
    try { await mkdir(lock); } catch { return { status: "busy" }; }
  }
  let staging;
  try {
    const attempted = Number(await readFile(path.join(root, "last-check"), "utf8").catch(() => "0"));
    if (!force && now - attempted < day) return { status: "not-due" };
    await writeFile(path.join(root, "last-check"), String(now), { mode: 0o600 });
    const release = await fetchRelease();
    if (release.name !== "@openai/codex" || !stable.test(release.version)) throw new Error("Invalid stable Codex release");
    const current = terminalCodexSelection({ root, baseVersion, enabled: true });
    if (compareVersions(release.version, current.version) <= 0) return { status: "current", version: current.version };
    await mkdir(path.join(root, "versions"), { recursive: true });
    staging = await mkdtemp(path.join(root, ".candidate-"));
    const env = { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: staging, CODEX_HOME: path.join(staging, "codex-home"),
      NPM_CONFIG_USERCONFIG: path.join(staging, "empty-user.npmrc"), NPM_CONFIG_GLOBALCONFIG: path.join(staging, "empty-global.npmrc"), NPM_CONFIG_CACHE: path.join(staging, "cache") };
    await run("/usr/local/bin/npm", ["install", "--prefix", staging, "--ignore-scripts", "--no-audit", "--no-fund",
      "--registry=https://registry.npmjs.org", "--save-exact", `@openai/codex@${release.version}`],
    { env, cwd: staging, timeout: 300_000, maxBuffer: 1024 * 1024 });
    const command = path.join(staging, "node_modules/@openai/codex/bin/codex.js");
    const { stdout } = await run(process.execPath, [command, "--version"], { env, cwd: staging, timeout: 10_000, maxBuffer: 65536 });
    if (stdout.trim() !== `codex-cli ${release.version}`) throw new Error("Candidate Codex version verification failed");
    await rm(path.join(staging, "cache"), { recursive: true, force: true });
    await rm(path.join(staging, "codex-home"), { recursive: true, force: true });
    const target = `versions/${release.version}`, destination = path.join(root, target);
    // Never overwrite a retained executable that an existing session could use.
    if (existsSync(destination)) throw new Error("Codex candidate destination already exists; operator review required");
    await rename(staging, destination);
    staging = undefined;
    const link = path.join(root, ".current-next");
    await rm(link, { force: true });
    await symlink(target, link);
    await rename(link, path.join(root, "current"));
    return { status: "updated", version: release.version };
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

export function startTerminalCodexUpdates({ baseVersion, enabled = false, log = console.log,
  policy, report = async () => {}, probation = false, root = terminalCodexRoot, update = updateTerminalCodex,
} = {}) {
  const options = { baseVersion, root };
  let busy = false, lastCheck = null, closed = false;
  const check = async () => {
    if (busy || closed || probation) return;
    busy = true;
    let result = "disabled", message = "Automatic updates are disabled; the installed version is retained.";
    try {
      // A configured control plane is authoritative. Unavailability must never
      // fall back to an old environment value and accidentally enable updates.
      const state = policy ? await policy() : { policy: { codexAutomatic: enabled }, maintenance: false };
      if (state.policy.codexAutomatic && !state.maintenance) {
        const outcome = await update(options);
        result = outcome.status;
        if (!["not-due", "busy"].includes(result)) lastCheck = new Date().toISOString();
        if (!lastCheck) {
          const attempted = Number(await readFile(path.join(root, "last-check"), "utf8").catch(() => "0"));
          if (attempted) lastCheck = new Date(attempted).toISOString();
        }
        message = result === "updated" ? "New Codex launches use the updated version." : "The installed version is retained.";
        if (result === "updated") log(`Terminal Codex updated to ${outcome.version}; new launches use it`);
      }
    } catch {
      result = "failed"; message = "Update check unavailable; the installed version is retained.";
      log("Terminal Codex update check unavailable; retaining the current executable");
    } finally {
      const attempted = Number(await readFile(path.join(root, "last-check"), "utf8").catch(() => "0"));
      if (Number.isFinite(attempted) && attempted > 0) lastCheck = new Date(attempted).toISOString();
      await report({ version: terminalCodexSelection(options).version, lastCheck, result, message }).catch(() => undefined);
      busy = false;
    }
  };
  void check();
  const timer = setInterval(() => void check(), 60_000); timer.unref();
  return { version: () => terminalCodexSelection(options).version, busy: () => busy,
    check, close: () => { closed = true; clearInterval(timer); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const release = JSON.parse(await readFile(new URL("./openclaw-release.json", import.meta.url), "utf8"));
  console.log(terminalCodexSelection({ baseVersion: release.codexVersion,
    enabled: process.env.NEURAL_LABS_CODEX_AUTO_UPDATE === "true" }).command);
}
