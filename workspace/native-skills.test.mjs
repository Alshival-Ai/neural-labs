import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { NativeSkills } from "./native/skills.mjs";
import { createSkillsManager, workspaceSkillActorId } from "./skills-manager.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-skills-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const manager = createSkillsManager({ personalRoot: path.join(root, "personal"), teamRoot: path.join(root, "team") });
  const skills = new NativeSkills({ manager, root: path.join(root, "executions") });
  const actor = id => ({ id: workspaceSkillActorId(id), userId: id, displayName: id, role: "user" });
  const save = (owner, name, scope = "personal") => manager.save(actor(owner), { name, description: `${name} fixture`, instructions: `Use ${name}`, scope });
  return { root, skills, manager, actor, save };
}
test("concurrent users on either provider get only their personal and enabled team packages", async t => {
  const f = await fixture(t);
  await f.save("alice", "alice-only"); await f.save("bob", "bob-only");
  const team = await f.save("alice", "shared", "team"), disabled = await f.save("alice", "paused", "team");
  const metaPath = path.join(path.dirname(disabled.path), ".neural-labs.json");
  const metadata = JSON.parse(await readFile(metaPath, "utf8"));
  await writeFile(metaPath, JSON.stringify({ ...metadata, enabled: false }));
  await mkdir(path.join(path.dirname(team.path), "scripts"));
  await writeFile(path.join(path.dirname(team.path), "scripts", "run.sh"), "#!/bin/sh\necho fixture\n", { mode: 0o755 });
  const [alice, bob] = await Promise.all([
    f.skills.prepare({ actor: "alice", provider: "codex", input: [{ type: "text", text: "$shared inspect" }] }),
    f.skills.prepare({ actor: "bob", provider: "claude", input: [{ type: "text", text: "$shared inspect" }] }),
  ]);
  assert.deepEqual(alice.packages.map(row => row.key).sort(), ["alice-only", "shared"]);
  assert.deepEqual(bob.packages.map(row => row.key).sort(), ["bob-only", "shared"]);
  assert.notEqual(alice.discovery, bob.discovery);
  assert.deepEqual(alice.input.at(-1), { type: "skill", name: "shared", path: "/opt/neural-labs/skills/shared/SKILL.md" });
  assert.match(bob.input.at(-1).text, /\/opt\/neural-labs\/skills\/shared\/SKILL.md/);
  const receipt = alice.packages.find(row => row.key === "shared");
  assert.equal(receipt.files.find(row => row.path === "SKILL.md").sha256, createHash("sha256").update(await readFile(team.path)).digest("hex"));
  const copied = alice.mounts.find(row => row.target.endsWith("/shared")).source;
  assert.equal((await stat(path.join(copied, "scripts", "run.sh"))).mode & 0o777, 0o500);
  await writeFile(team.path, "Canonical changes after launch");
  assert.notEqual(await readFile(path.join(copied, "SKILL.md"), "utf8"), "Canonical changes after launch");
  await alice.release();
  assert.deepEqual(await readdir(bob.discovery), ["bob-only", "shared"]);
  await bob.release(); assert.deepEqual(await readdir(path.join(f.root, "executions")), []);
});
test("linked package content fails closed and cleans up its execution snapshot", async t => {
  const f = await fixture(t), skill = await f.save("alice", "linked");
  await symlink("/etc", path.join(path.dirname(skill.path), "references"));
  await assert.rejects(f.skills.prepare({ actor: "alice", provider: "claude", input: [{ type: "text", text: "$linked" }] }));
  assert.deepEqual(await readdir(path.join(f.root, "executions")), []);
});
test("Team Chat activates only skills in the triggering message, not historical transcript text", async t => {
  const f = await fixture(t);
  await f.save("alice", "alice-private");
  await f.save("alice", "old-skill", "team");
  await f.save("alice", "current-skill", "team");
  const prepared = await f.skills.prepare({ actor: "alice", provider: "codex",
    input: [{ type: "text", text: "Earlier: $old-skill. Triggering message: $current-skill" }],
    requestedSkillText: "@Alshival $current-skill please", scope: "team" });
  assert.deepEqual(prepared.packages.map(row => row.key).sort(), ["current-skill", "old-skill"]);
  assert.deepEqual(prepared.input.filter(row => row.type === "skill").map(row => row.name), ["current-skill"]);
  await prepared.release();
});
test("disabled state survives builder edits and scope changes", async t => {
  const f = await fixture(t), skill = await f.save("alice", "paused");
  const file = path.join(path.dirname(skill.path), ".neural-labs.json");
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), enabled: false }));
  await f.manager.save(f.actor("alice"), { name: "paused", description: "edited", instructions: "edited", scope: "personal" }, "paused");
  await f.manager.share(f.actor("alice"), "paused", "team");
  assert.equal((await f.manager.list(f.actor("alice")))[0].enabled, false);
});
