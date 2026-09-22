import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkPins, validateRelease, checkUpstreamBoundary } from "../bin/openclaw-release.mjs";

const root = path.resolve(import.meta.dirname, "..");
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "neural-release-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const release = JSON.parse(await readFile(path.join(root, "workspace/openclaw-release.json"), "utf8"));
  const files = [".env.example", "workspace/openclaw-release.json", "workspace/Containerfile", "deploy/compose/compose.yaml",
    ...["workspace", "workspace/desktop"].flatMap((p) => [`${p}/package.json`, `${p}/package-lock.json`]), ...release.patches];
  for (const file of files) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await copyFile(path.join(root, file), path.join(dir, file));
  }
  return { dir, release };
}

test("offline release check catches an image mismatch", async (t) => {
  const { dir, release } = await fixture(t);
  await checkPins(dir);
  const file = path.join(dir, "workspace/Containerfile");
  await writeFile(file, (await readFile(file, "utf8")).replace(release.image, "ghcr.io/openclaw/openclaw:2099.1.1@sha256:" + "f".repeat(64)));
  await assert.rejects(checkPins(dir), /release pin drift: workspace\/Containerfile/);
});

test("sync changes public pins but never writes the deployment environment or locks", async (t) => {
  const { dir, release } = await fixture(t);
  const envFile = path.join(dir, ".env");
  const env = `NEURAL_LABS_OPENCLAW_VERSION=${release.version}\nUNRELATED_VALUE=placeholder\n`;
  await writeFile(envFile, env);
  release.version = "2099.1.1";
  release.image = `ghcr.io/openclaw/openclaw:${release.version}@sha256:${"a".repeat(64)}`;
  release.sourceRevision = "b".repeat(40);
  await writeFile(path.join(dir, "workspace/openclaw-release.json"), JSON.stringify(release));
  await checkPins(dir, { sync: true });
  assert.equal(await readFile(envFile, "utf8"), env);
  await assert.rejects(checkPins(dir, { envFile }), /lockfile drift/);
  for (const prefix of ["workspace", "workspace/desktop"]) {
    const file = path.join(dir, prefix, "package-lock.json");
    const lock = JSON.parse(await readFile(file, "utf8"));
    for (const name of release.packages.filter((name) => name in lock.packages[""].dependencies)) {
      lock.packages[""].dependencies[name] = release.version;
      lock.packages[`node_modules/${name}`].version = release.version;
    }
    await writeFile(file, JSON.stringify(lock));
  }
  await checkPins(dir);
  await assert.rejects(checkPins(dir, { envFile }), /deployment override differs/);
});

test("missing pin locations and invalid image provenance fail closed", async (t) => {
  const { dir, release } = await fixture(t);
  assert.throws(() => validateRelease({ ...release, image: "openclaw:latest" }));
  assert.throws(() => validateRelease({ ...release, patches: ["../private.patch"] }));
  await writeFile(path.join(dir, "workspace/Containerfile"), "FROM scratch\n");
  await assert.rejects(checkPins(dir, { sync: true }), /Missing release pin location/);
});


test("rejects runtime overlays, source patches and managed Codex overrides", async (t) => {
  const { dir, release } = await fixture(t);
  assert.throws(() => validateRelease({ ...release, patches: ["workspace/patches/runtime.patch"] }), /prohibited/);
  for (const instruction of [
    "COPY --from=build /build/dist /app/dist",
    "RUN rm -rf /app/dist",
    "RUN ln -sf /usr/local/bin/codex \\\n /app/extensions/codex/node_modules/.bin/codex",
    "WORKDIR /app",
    "RUN git apply /tmp/runtime.patch",
    "ENV OPENCLAW_CODEX_APP_SERVER_COMMAND=/usr/local/bin/codex",
  ]) assert.throws(() => checkUpstreamBoundary(instruction), /inherited unchanged/);
  checkUpstreamBoundary('COPY workspace/start.mjs /usr/local/lib/neural-labs/start.mjs\nHEALTHCHECK CMD ["node", "/app/dist/docker-healthcheck.js"]');
  await mkdir(path.join(dir, "workspace/patches"), { recursive: true });
  await writeFile(path.join(dir, "workspace/patches/unlisted.patch"), "a forgotten overlay");
  await assert.rejects(checkPins(dir), /source patch files are prohibited/);
});

test("workspace startup disables autonomous Skill Workshop maintenance", async () => {
  const source = await readFile(path.join(root, "workspace/start.mjs"), "utf8");
  assert.match(source, /path:\s*"skills\.workshop\.autonomous\.mode",\s*value:\s*"off"/u);
});
