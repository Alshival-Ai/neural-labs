#!/usr/bin/env node
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifestPath = "workspace/openclaw-release.json";
const releaseVersion = /^\d{4}\.\d+\.\d+(?:[.-][a-zA-Z0-9.-]+)?$/u;
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

export function validateRelease(release) {
  if (!releaseVersion.test(release.version) || !/^[a-f0-9]{40}$/u.test(release.sourceRevision) ||
      !/^\d+\.\d+\.\d+$/u.test(release.codexVersion) ||
      (release.appServerVersion !== undefined && !/^\d+\.\d+\.\d+$/u.test(release.appServerVersion)) ||
      !release.image?.startsWith(`ghcr.io/openclaw/openclaw:${release.version}@sha256:`) ||
      !/@sha256:[a-f0-9]{64}$/u.test(release.image) ||
      !Array.isArray(release.packages) || !["@openclaw/gateway-client", "@openclaw/gateway-protocol", "@openclaw/sms"].every((name) => release.packages.includes(name)) ||
      !Array.isArray(release.patches)) throw new Error("Invalid OpenClaw release manifest");
  if (release.patches.length) throw new Error("OpenClaw source patches are prohibited; keep customizations in Neural Labs");
}

// An intentionally conservative review guard, not a Dockerfile security parser.
// The operator image comparison also verifies the resulting /app tree.
export function checkUpstreamBoundary(containerfile) {
  const instructions = containerfile.replace(/\\\r?\n/g, " ").split(/\r?\n/u)
    .filter((line) => !/^\s*(?:#|$)/u.test(line));
  for (const line of instructions) {
    if (/^\s*(?:RUN|COPY|ADD|WORKDIR|ENV|ARG)\b/iu.test(line) &&
        (/(?:^|[^\w])\/app(?:\/|\b)/u.test(line) || /git\s+apply|planning-build|OPENCLAW_CODEX_APP_SERVER_COMMAND/iu.test(line))) {
      throw new Error("OpenClaw /app must remain inherited unchanged; move customization into Neural Labs");
    }
  }
}

// Only generated pin locations are rewritten. Tests, historical release notes,
// private .env files and lockfiles are never edited.
export function pinRules(release) {
  return [
    [".env.example", /^NEURAL_LABS_OPENCLAW_IMAGE=.*$/gm, `NEURAL_LABS_OPENCLAW_IMAGE=${release.image}`],
    [".env.example", /^NEURAL_LABS_OPENCLAW_VERSION=.*$/gm, `NEURAL_LABS_OPENCLAW_VERSION=${release.version}`],
    [".env.example", /^NEURAL_LABS_CODEX_VERSION=.*$/gm, `NEURAL_LABS_CODEX_VERSION=${release.codexVersion}`],
    ["workspace/Containerfile", /^ARG OPENCLAW_IMAGE=.*$/gm, `ARG OPENCLAW_IMAGE=${release.image}`],
    ["workspace/Containerfile", /^ARG CODEX_VERSION=.*$/gm, `ARG CODEX_VERSION=${release.codexVersion}`],
    ...(release.appServerVersion ? [["workspace/Containerfile", /^ARG CODEX_APP_SERVER_VERSION=.*$/gm, `ARG CODEX_APP_SERVER_VERSION=${release.appServerVersion}`]] : []),
    ["workspace/Containerfile", /NEURAL_LABS_OPENCLAW_VERSION=[^\s\\]+/g, `NEURAL_LABS_OPENCLAW_VERSION=${release.version}`],
    ["deploy/compose/compose.yaml", /\$\{NEURAL_LABS_OPENCLAW_IMAGE:-[^}]+\}/g, '${NEURAL_LABS_OPENCLAW_IMAGE:-' + release.image + '}'],
    ["deploy/compose/compose.yaml", /\$\{NEURAL_LABS_OPENCLAW_VERSION:-[^}]+\}/g, '${NEURAL_LABS_OPENCLAW_VERSION:-' + release.version + '}'],
    ["deploy/compose/compose.yaml", /\$\{NEURAL_LABS_CODEX_VERSION:-[^}]+\}/g, '${NEURAL_LABS_CODEX_VERSION:-' + release.codexVersion + '}'],
  ];
}

export async function checkPins(directory = root, { sync = false, envFile } = {}) {
  const release = await readJson(path.join(directory, manifestPath));
  validateRelease(release);
  const errors = [];
  const pending = new Map();
  for (const [file, pattern, replacement] of pinRules(release)) {
    const source = pending.get(file) ?? await readFile(path.join(directory, file), "utf8");
    if (![...source.matchAll(pattern)].length) throw new Error(`Missing release pin location in ${file}`);
    const expected = source.replace(pattern, () => replacement);
    if (expected !== source) errors.push(`release pin drift: ${file}`);
    pending.set(file, expected);
  }
  for (const directoryName of ["workspace", "workspace/desktop"]) {
    const file = `${directoryName}/package.json`;
    const pkg = await readJson(path.join(directory, file));
    for (const name of release.packages) {
      if (!(name in (pkg.dependencies ?? {}))) {
        if (name !== "@openclaw/sms" || directoryName === "workspace") errors.push(`missing dependency: ${file} ${name}`);
        continue;
      }
      if (pkg.dependencies[name] !== release.version) errors.push(`dependency drift: ${file} ${name}`);
      pkg.dependencies[name] = release.version;
    }
    pending.set(file, JSON.stringify(pkg, null, 2) + "\n");
    if (!sync) {
      const lock = await readJson(path.join(directory, `${directoryName}/package-lock.json`));
      for (const name of release.packages.filter((name) => name in pkg.dependencies)) {
        if (lock.packages?.[""]?.dependencies?.[name] !== release.version ||
            lock.packages?.[`node_modules/${name}`]?.version !== release.version) errors.push(`lockfile drift: ${directoryName} ${name}`);
      }
    }
  }
  const containerfile = await readFile(path.join(directory, "workspace/Containerfile"), "utf8");
  checkUpstreamBoundary(containerfile);
  const patchFiles = await readdir(path.join(directory, "workspace/patches")).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  if (patchFiles.some((name) => /\.(patch|diff)$/iu.test(name))) throw new Error("OpenClaw source patch files are prohibited");
  if (envFile) {
    const values = Object.fromEntries((await readFile(envFile, "utf8")).split(/\r?\n/u).flatMap((line) => {
      const match = line.match(/^(NEURAL_LABS_(?:OPENCLAW_IMAGE|OPENCLAW_VERSION|CODEX_VERSION))=(.*)$/u);
      return match ? [[match[1], match[2].replace(/^(["'])(.*)\1$/u, "$2")]] : [];
    }));
    for (const [key, value] of Object.entries({ NEURAL_LABS_OPENCLAW_IMAGE: release.image, NEURAL_LABS_OPENCLAW_VERSION: release.version, NEURAL_LABS_CODEX_VERSION: release.codexVersion })) {
      if (values[key] !== undefined && values[key] !== value) errors.push(`deployment override differs from reviewed release: ${key}`);
    }
  }
  if (sync) {
    if (errors.some((error) => error.startsWith("missing dependency:"))) throw new Error(errors.filter((error) => error.startsWith("missing dependency:")).join("\n"));
    for (const [file, content] of pending) await writeFile(path.join(directory, file), content);
  } else if (errors.length) throw new Error([...new Set(errors)].join("\n"));
  return release;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": "neural-labs-release-review", Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Release discovery failed (${response.status}) at ${new URL(url).hostname}`);
  return response.json();
}

export async function inspectRelease(version = "latest") {
  if (version !== "latest" && !releaseVersion.test(version)) throw new Error("Use an exact release version or latest");
  const release = await getJson(`https://api.github.com/repos/openclaw/openclaw/releases/${version === "latest" ? "latest" : `tags/v${version}`}`);
  const target = release.tag_name.replace(/^v/u, "");
  const results = await Promise.allSettled([
    getJson(`https://api.github.com/repos/openclaw/openclaw/commits/${release.tag_name}`),
    ...["openclaw", "@openclaw/sms", "@openclaw/gateway-client", "@openclaw/gateway-protocol"].map((name) => getJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/${target}`)),
  ]);
  for (const result of results) if (result.status === "rejected") throw result.reason;
  const [commit, ...packages] = results.map((result) => result.value);
  return { version: target, publishedAt: release.published_at, prerelease: release.prerelease, sourceRevision: commit.sha,
    releaseNotes: release.html_url, packages: packages.map((pkg) => ({ name: pkg.name, version: pkg.version, engines: pkg.engines, integrity: pkg.dist?.integrity })),
    next: `Verify the image digest and source revision: docker buildx imagetools inspect ghcr.io/openclaw/openclaw:${target}. This report does not approve or change any pins.` };
}

export async function checkSource(source, directory = root) {
  const release = await readJson(path.join(directory, manifestPath));
  validateRelease(release);
  const pkg = await readJson(path.join(source, "package.json"));
  const codex = await readJson(path.join(source, "extensions/codex/package.json"));
  return { sourceVersion: pkg.version, reviewedVersion: release.version, node: pkg.engines?.node,
    upstreamCodex: codex.dependencies?.["@openai/codex"], terminalCodex: release.codexVersion,
    patches: [],
    note: "OpenClaw is inherited unchanged; no source rebase or compile is required. The terminal CLI is independent of upstream Codex. Verify source provenance and test auth, protocol, migrations and runtime contracts." };

}

async function main() {
  const [command = "check", ...args] = process.argv.slice(2);
  if (command === "check" || command === "sync") {
    if (args.length && !(command === "check" && args.length === 2 && args[0] === "--env")) throw new Error("Usage: check [--env FILE] | sync");
    const release = await checkPins(root, { sync: command === "sync", envFile: args[1] });
    console.log(command === "sync" ? "Updated public pins. Regenerate both npm lockfiles, then run check and make validate." : `OpenClaw ${release.version}: release pins and lockfiles agree`);
  } else if (command === "inspect") {
    if (args.length > 1) throw new Error("Usage: inspect [VERSION|latest]");
    console.log(JSON.stringify(await inspectRelease(args[0]), null, 2));
  } else if (command === "check-source" && args.length === 1) {
    const report = await checkSource(path.resolve(args[0]));
    console.log(JSON.stringify(report, null, 2));
  } else throw new Error("Usage: node bin/openclaw-release.mjs check [--env FILE] | sync | inspect [VERSION] | check-source SOURCE_DIRECTORY");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
