import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceSkillError, createSkillsManager } from "./skills-manager.mjs";

const maya = { id: "maya-id", displayName: "Maya", role: "user" };
const owen = { id: "owen-id", displayName: "Owen", role: "user" };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "neural-labs-skills-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const personalRoot = path.join(root, "home", ".agents", "skills");
  const teamRoot = path.join(root, "home", "workspace", "skills");
  return { personalRoot, teamRoot, manager: createSkillsManager({ personalRoot, teamRoot }) };
}

test("personal skills save immediately and stay explicit-invocation only", async (t) => {
  const { manager, personalRoot } = await fixture(t);
  const created = await manager.save(maya, {
    name: "Customer Handoff",
    description: "Prepare an engineering handoff.",
    instructions: "# Customer handoff\n\nCapture evidence and name an owner.",
    scope: "personal",
  });

  assert.equal(created.key, "customer-handoff");
  assert.equal(created.ownedByCurrentUser, true);
  const content = await readFile(path.join(personalRoot, "customer-handoff", "SKILL.md"), "utf8");
  assert.match(content, /disable-model-invocation: true/);
  assert.match(content, /Capture evidence and name an owner/);

  const visibleToCoworker = await manager.list(owen);
  assert.equal(visibleToCoworker[0].ownedByCurrentUser, false);
  assert.equal(visibleToCoworker[0].editable, false);
});

test("an owner can promote a personal skill to the team without approval state", async (t) => {
  const { manager, teamRoot } = await fixture(t);
  await manager.save(maya, {
    name: "Release Notes",
    description: "Summarize merged changes.",
    instructions: "# Release notes\n\nGroup changes by outcome.",
    scope: "personal",
  });

  const shared = await manager.share(maya, "release-notes", "team");
  assert.equal(shared.scope, "team");
  const content = await readFile(path.join(teamRoot, "release-notes", "SKILL.md"), "utf8");
  assert.match(content, /disable-model-invocation: false/);
  assert.equal((await manager.list(owen))[0].scope, "team");
});

test("other users cannot edit or share a personal skill", async (t) => {
  const { manager } = await fixture(t);
  await manager.save(maya, {
    name: "Private Workflow",
    description: "Maya's workflow.",
    instructions: "# Private workflow\n\nFollow Maya's steps.",
    scope: "personal",
  });

  await assert.rejects(
    manager.share(owen, "private-workflow", "team"),
    (error) => error instanceof WorkspaceSkillError && error.status === 403,
  );
});

test("skill files reject obvious credentials", async (t) => {
  const { manager } = await fixture(t);
  await assert.rejects(
    manager.save(maya, {
      name: "Unsafe",
      description: "Contains a secret.",
      instructions: `Use ${"sk-" + "a".repeat(32)} as the provider token.`,
      scope: "personal",
    }),
    (error) => error instanceof WorkspaceSkillError && error.code === "credential_detected",
  );
});

test("package publishing preserves support files and scans them for credentials", async (t) => {
  const { manager, personalRoot } = await fixture(t);
  const source = "---\nname: package-skill\ndescription: \"Uses a reference.\"\n---\n\n# Package skill\n";
  await manager.savePackage(maya, {
    fields: { name: "Package skill", slug: "package-skill", description: "Uses a reference.", scope: "personal" },
    files: [
      { path: "SKILL.md", content: source, kind: "text" },
      { path: "references/guide.md", content: "# Guide\n", kind: "text" },
      { path: "assets/mark.bin", content: Buffer.from([1, 2, 3]), kind: "asset" },
    ],
  });
  assert.equal(await readFile(path.join(personalRoot, "package-skill", "references", "guide.md"), "utf8"), "# Guide\n");

  await assert.rejects(manager.savePackage(maya, {
    fields: { name: "Unsafe package", slug: "unsafe-package", description: "Contains a secret.", scope: "personal" },
    files: [
      { path: "SKILL.md", content: source.replace("package-skill", "unsafe-package"), kind: "text" },
      { path: "scripts/run.sh", content: `TOKEN=${"sk-" + "a".repeat(32)}`, kind: "text" },
    ],
  }), (error) => error instanceof WorkspaceSkillError && error.code === "credential_detected");
});

test("saved duplication preserves packages, allocates unique identities, and enforces deletion ownership",async(t)=>{
 const {manager}=await fixture(t);
 const original=await manager.savePackage(maya,{fields:{name:'Original',description:'Complete package',scope:'team'},files:[
 {path:'SKILL.md',kind:'text',content:'---\nname: original\ndescription: Complete package\ndisable-model-invocation: false\n---\n# Instructions'},
 {path:'references/help.md',kind:'text',content:'Reference'},
 {path:'scripts/run.sh',kind:'text',content:'#!/bin/bash\necho example'},
 {path:'assets/icon.png',kind:'asset',content:Buffer.from([0,255,3])},
 ]});
 const [a,b]=await Promise.all([manager.duplicate(owen,{path:original.path}),manager.duplicate(owen,{path:original.path})]);
 assert.notEqual(a.key,b.key);assert.equal(a.scope,'personal');assert.equal(a.ownerUserId,owen.id);
 const pkg=await manager.readPackage(owen,a.key);assert.equal(pkg.files.length,4);assert.equal(pkg.files.find(f=>f.path==='assets/icon.png').data,Buffer.from([0,255,3]).toString('base64'));assert.match(pkg.files[0].content??(await readFile(a.path,'utf8')),/disable-model-invocation: true/);
 await assert.rejects(manager.remove(owen,{path:original.path}),e=>e.status===403);
 await manager.remove(owen,{path:a.path});assert.ok((await manager.list(owen)).some(s=>s.key===original.key));
 await manager.remove({...owen,role:'admin'},{path:original.path});
});

test("installed Team skills require admin deletion and linked sources are rejected",async(t)=>{
 const {manager,teamRoot,personalRoot}=await fixture(t);const {mkdir,writeFile,symlink}=await import('node:fs/promises');
 await mkdir(path.join(teamRoot,'installed'),{recursive:true});await mkdir(personalRoot,{recursive:true});const source=path.join(teamRoot,'installed','SKILL.md');await writeFile(source,'---\nname: installed\ndescription: Installed\n---\nUse this.');
 await assert.rejects(manager.remove(maya,{path:source}),e=>e.status===403);
 const copy=await manager.duplicate(maya,{path:source});assert.equal(copy.scope,'personal');
 await symlink(path.join(teamRoot,'installed'),path.join(teamRoot,'linked'));
 await assert.rejects(manager.duplicate(maya,{path:path.join(teamRoot,'linked','SKILL.md')}));
 await manager.remove({...maya,role:'admin'},{path:source});
});

test("admin Team editing preserves identity and ownership, while personal skills stay protected", async (t) => {
  const { manager } = await fixture(t);
  const admin = { ...owen, role: "admin" };
  for (const scope of ["team", "personal"]) {
    const input = { name: `${scope} workflow`, description: "Workflow", instructions: "Original", scope };
    const original = await manager.save(maya, input);
    const pkg = { fields: input, files: [
      { path: "SKILL.md", content: "Published instructions" },
      { path: "references/help.md", content: "Reference" },
      { path: "assets/icon.bin", kind: "asset", content: Buffer.from([0, 255]) },
    ] };
    assert.equal((await manager.list(admin)).find(s => s.key === original.key).editable, scope === "team");
    await assert.rejects(manager.save(owen, input, original.key), e => e.status === 403);
    await assert.rejects(manager.savePackage(owen, pkg, original.key), e => e.status === 403);
    if (scope === "personal") {
      await assert.rejects(manager.save(admin, input, original.key), e => e.status === 403);
      await assert.rejects(manager.savePackage(admin, pkg, original.key), e => e.status === 403);
      continue;
    }
    const updated = await manager.save(admin, { ...input, instructions: "Updated" }, original.key);
    assert.equal(updated.path, original.path);
    assert.equal(updated.ownerUserId, maya.id);
    const published = await manager.savePackage(admin, pkg, original.key);
    assert.equal(published.path, original.path);
    assert.equal(published.ownerUserId, maya.id);
    assert.equal(published.scope, "team");
    assert.equal((await manager.readPackage(admin, original.key)).files.length, 3);
    await assert.rejects(manager.save(admin, { ...input, scope: "personal" }, original.key), e => e.status === 403);
    await assert.rejects(manager.savePackage(admin, { ...pkg, fields: { ...input, scope: "personal" } }, original.key), e => e.status === 403);
    await assert.rejects(manager.share(admin, original.key, "personal"), e => e.status === 403);
    assert.equal((await manager.readPackage(admin, original.key)).skill.instructions, "Published instructions");
  }
  assert.equal((await manager.list(admin)).length, 2);
});

test("admins edit installed Team packages without duplication, excluding symlinks", async (t) => {
  const { manager, teamRoot } = await fixture(t);
  const { mkdir, writeFile, symlink } = await import("node:fs/promises");
  const directory = path.join(teamRoot, "installed");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "SKILL.md"), "---\nname: installed\ndescription: Installed workflow\n---\nOriginal");
  await symlink(directory, path.join(teamRoot, "linked"));
  const admin = { ...owen, role: "admin" };
  const records = await manager.list(admin);
  assert.equal(records.length, 1);
  assert.equal(records[0].editable, true);
  assert.equal((await manager.list(maya))[0].editable, false);
  const pkg = await manager.readPackage(admin, "installed");
  pkg.files[0].content = "Updated installed workflow";
  await assert.rejects(manager.savePackage(maya, { fields: records[0], files: pkg.files }, "installed"), e => e.status === 403);
  const saved = await manager.savePackage(admin, { fields: records[0], files: pkg.files }, "installed");
  assert.equal(saved.path, path.join(directory, "SKILL.md"));
  assert.equal(saved.scope, "team");
  assert.equal(saved.ownedByCurrentUser, false);
  assert.equal((await manager.list(admin)).length, 1);
});
