import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFile(path.join(root, file), "utf8");
const manifest = JSON.parse(await read("workspace/native/release.json"));
export async function checkNativeRelease() {
  assert.equal(manifest.protocol, 1);
  assert.match(manifest.baseImage, /^node:22-bookworm-slim@sha256:[a-f0-9]{64}$/);
  for (const version of [manifest.version, manifest.codex, manifest.claude, manifest.supercronic.version, manifest.codeServer.version])
    assert.match(version, /^\d+\.\d+\.\d+$/);
  for (const component of [manifest.supercronic, manifest.codeServer]) {
    assert.deepEqual(Object.keys(component.sha256).sort(), ["amd64", "arm64"]);
    for (const digest of Object.values(component.sha256)) assert.match(digest, /^[a-f0-9]{64}$/);
  }
  const container = await read("workspace/Containerfile");
  assert.ok(container.includes(`ARG NATIVE_BASE_IMAGE=${manifest.baseImage}`));
  for (const [key, version] of [["RUNTIME", manifest.version], ["CODEX", manifest.codex], ["CLAUDE", manifest.claude]])
    assert.ok(container.includes(`NEURAL_LABS_${key}_VERSION=${version}`), `Image identity pin mismatch: ${key}`);
  assert.ok(!/FROM.*openclaw|COPY.*(?:gateway|openclaw|plugins?\b)/i.test(container), "Legacy runtime layers must not enter the native image");
  for (const component of ["workspace", "workspace/desktop", "mcp", "control-plane"]) {
    const lock = JSON.parse(await read(`${component}/package-lock.json`));
    assert.ok(!Object.keys(lock.packages).some(key => /(?:^|\/)@openclaw\//.test(key)), `${component} retains a Gateway package`);
  }
  assert.ok((await read("workspace/native/codex.mjs")).includes(`CODEX_PROTOCOL_VERSION = "${manifest.codex}"`));
  assert.ok((await read("workspace/native/claude.mjs")).includes(`"${manifest.claude}"`));
  // Walk the runtime's local imports so a transitive legacy adapter cannot be
  // accidentally brought back by a new entrypoint import.
  const visited = new Set();
  async function visit(filename) {
    if (visited.has(filename)) return;
    visited.add(filename);
    assert.ok(!/(?:openclaw-runtime|gateway-isolation|personal-openai|team-openai|provider-display-cache|claude-plugin|alshival-plugin)/.test(filename), `Legacy execution module: ${filename}`);
    const source = await read(filename);
    assert.ok(!/from\s+["']@openclaw\//.test(source), `Legacy runtime import: ${filename}`);
    for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*)["'](\.[^"']+\.mjs)["']/g))
      await visit(path.posix.normalize(path.posix.join(path.posix.dirname(filename), match[1])));
  }
  await visit("workspace/start.mjs");
  const copied = container.replace(/\\\r?\n/g, " ").split("\n")
    .filter(line => /^COPY\s/.test(line) && !line.includes("--from="))
    .flatMap(line => line.trim().split(/\s+/).slice(1, -1).filter(value => !value.startsWith("--")));
  for (const filename of visited)
    assert.ok(copied.some(source => filename === source || filename.startsWith(`${source}/`)), `Runtime module missing from image COPY: ${filename}`);
  return { protocol: manifest.protocol, codex: manifest.codex, claude: manifest.claude, runtimeModules: visited.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] || "check";
  if (!["check", "inspect"].includes(command)) throw new Error("Usage: native-release.mjs check [--env FILE] | inspect");
  const flag = process.argv.indexOf("--env");
  if (flag >= 0) {
    const env = await readFile(process.argv[flag + 1], "utf8");
    const selected = /^NEURAL_LABS_WORKSPACE_IMAGE=(.+)$/m.exec(env)?.[1]?.trim();
    if (selected && selected !== "neural-labs-workspace:local")
      assert.match(selected, /^[^\s]+@sha256:[a-f0-9]{64}$/, "Released runtime images must use an immutable digest");
  }
  console.log(JSON.stringify(command === "inspect" ? manifest : await checkNativeRelease()));
}
