import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createSkillsManager, workspaceSkillActorId } from "./skills-manager.mjs";
import { NativeSkills } from "./native/skills.mjs";
import { checkSite } from "./bundled-skills/site-generator/scripts/check-site.mjs";

const bundled = fileURLToPath(new URL("./bundled-skills/", import.meta.url));
const expected = ["business-research-and-media", "cinematic-interactions", "deploy", "local-business-website-builder", "site-generator", "web-video-asset-preparation"];

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "website-toolkit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("runtime packages exactly the public toolkit with resolvable resources", async t => {
  const root = await fixture(t), library = path.join(root, "library"); await mkdir(library);
  const containerfile = await readFile(new URL("./Containerfile", import.meta.url), "utf8");
  const names = [...containerfile.matchAll(/^COPY workspace\/bundled-skills\/([a-z0-9-]+) \/usr\/local\/share\/neural-labs\/skills\/\1$/gm)].map(match => match[1]);
  assert.deepEqual(names.sort(), expected);
  // Real package copies exercise ownership metadata, snapshotting and discovery.
  const { cp } = await import("node:fs/promises");
  for (const name of names) await cp(path.join(bundled, name), path.join(library, name), { recursive: true });
  const manager = createSkillsManager({ personalRoot: path.join(root, "personal"), teamRoot: path.join(root, "team"), libraryRoots: [library] });
  const actor = { id: workspaceSkillActorId("alice"), userId: "alice", role: "user" };
  assert.deepEqual((await manager.library(actor)).map(row => row.key).sort(), expected);
  assert.ok((await manager.library(actor)).every(row => row.editable === false));
  const skills = new NativeSkills({ manager, root: path.join(root, "runs") });
  for (const provider of ["codex", "claude"]) {
    const prepared = await skills.prepare({ actor: "alice", provider, explicitOnly: true, input: [{ type: "text", text: "$site-generator Build a personal portfolio" }] });
    assert.deepEqual(prepared.packages.map(row => row.key).sort(), expected);
    await prepared.release();
  }
  const copy = await manager.duplicate(actor, { path: path.join(library, "site-generator", "SKILL.md") });
  const copied = await skills.prepare({ actor: "alice", provider: "claude", explicitOnly: true, input: [{ type: "text", text: `$${copy.slug || copy.key}` }] });
  assert.ok(copied.packages.some(row => row.source === copy.path));
  assert.ok(copied.packages.some(row => row.key === "cinematic-interactions"));
  assert.equal(copied.packages.length, 6);
  await copied.release();
  const override = await manager.save(actor, { name: "site-generator", description: "Personal generator", instructions: "Personal instructions", scope: "personal" });
  const personal = await skills.prepare({ actor: "alice", provider: "codex", explicitOnly: true, input: [{ type: "text", text: "$site-generator" }] });
  assert.equal(personal.packages.length, 1); assert.equal(personal.packages[0].source, override.path);
  assert.equal((await manager.library(actor)).length, 6); await personal.release();

  async function inspect(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { await inspect(file); continue; }
      if (!/\.(md|mjs|json|yaml)$/.test(entry.name)) continue;
      const source = await readFile(file, "utf8");
      assert.doesNotMatch(source, /demo-pi|alshival\.(?:dev|ai|cloud)|192\.168\.|\/home\/data-team|OPENCLAW_GATEWAY_PASSWORD|richboys|Dream Creations|demo-pi|prospect-video-site|website-template-1/i, file);
      if (!entry.name.endsWith(".md")) continue;
      for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1].split("#")[0];
        if (!target || /^https?:|^mailto:/.test(target)) continue;
        await readFile(path.resolve(path.dirname(file), target));
      }
    }
  }
  await inspect(library);
});

test("static output checks work without business identity, domain or provider credentials", async t => {
  const root = await fixture(t), output = path.join(root, "dist"); await mkdir(output);
  await writeFile(path.join(output, "index.html"), '<!doctype html><html lang="en"><title>Hello</title><h1>Hello, World!</h1></html>');
  const result = await checkSite(output); assert.equal(result.ok, true); assert.equal(result.files, 1);
  await writeFile(path.join(output, ".env"), "FIXTURE_ONLY=yes");
  await symlink(path.join(root, "outside"), path.join(output, "linked"));
  const bad = await checkSite(output); assert.equal(bad.ok, false);
  assert.deepEqual(bad.failures.map(row => row.path), [".env", "linked"]);
  await rm(path.join(output, "index.html"));
  assert.ok((await checkSite(output)).failures.some(row => row.path === "index.html"));
});
