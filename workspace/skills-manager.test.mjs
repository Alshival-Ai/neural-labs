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
