import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as Y from "yjs";

import { BuilderError, createBuilderManager } from "./builder-manager.mjs";

const maya = { id: "maya-hash", userId: "maya-id", displayName: "Maya", role: "user" };
const owen = { id: "owen-hash", userId: "owen-id", displayName: "Owen", role: "user" };
const admin = { id: "admin-hash", userId: "admin-id", displayName: "Admin", role: "admin" };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "neural-labs-builder-"));
  const publications = [];
  const manager = createBuilderManager({
    root,
    publishSkill: async (_actor, skillPackage, targetKey) => {
      publications.push({ skillPackage, targetKey });
      return { key: targetKey ?? skillPackage.fields.slug, updatedAt: "2026-09-03T00:00:00.000Z" };
    },
  });
  t.after(async () => { await manager.close(); await rm(root, { recursive: true, force: true }); });
  return { manager, publications };
}

test("skill drafts autosave complete packages and publish only explicit snapshots", async (t) => {
  const { manager, publications } = await fixture(t);
  const draft = await manager.create(maya, {
    kind: "skill",
    initial: {
      name: "Release helper",
      key: "release-helper",
      description: "Create useful release summaries.",
      files: [{ path: "references/style.md", kind: "text", content: "# Style\n\nLead with outcomes.\n" }],
    },
  });

  assert.equal(draft.kind, "skill");
  assert.equal((await manager.validate(maya, draft.id)).issues.length, 0);
  const published = await manager.publish(maya, draft.id);
  assert.equal(published.skill.key, "release-helper");
  assert.deepEqual(publications[0].skillPackage.files.map((file) => file.path).sort(), ["SKILL.md", "agents/openai.yaml", "references/style.md"]);
  assert.equal((await manager.get(maya, draft.id)).draft.publishedKey, "release-helper");
});

test("draft access follows owner, selected collaborators, and administrator visibility", async (t) => {
  const { manager } = await fixture(t);
  const draft = await manager.create(maya, { kind: "skill", initial: { name: "Shared draft", description: "A collaborative skill." } });
  await assert.rejects(manager.get(owen, draft.id), (error) => error instanceof BuilderError && error.status === 403);

  await manager.collaborators(maya, draft.id, [owen.userId]);
  assert.equal((await manager.get(owen, draft.id)).draft.id, draft.id);
  assert.equal((await manager.list(admin)).some((item) => item.id === draft.id), true);
  await assert.rejects(manager.publish(owen, draft.id), (error) => error instanceof BuilderError && error.code === "owner_required");
});

test("automation creation and publication require an administrator", async (t) => {
  const { manager } = await fixture(t);
  await assert.rejects(manager.create(maya, { kind: "automation" }), (error) => error instanceof BuilderError && error.code === "administrator_required");
  const draft = await manager.create(admin, { kind: "automation", initial: { name: "Daily notes", payload: "Summarize today's work." } });
  const result = await manager.publish(admin, draft.id);
  assert.equal(result.kind, "automation");
  assert.equal(result.draft.name, "Daily notes");
});

test("assets cannot escape the supported package directory", async (t) => {
  const { manager } = await fixture(t);
  const draft = await manager.create(maya, { kind: "skill", initial: { name: "Asset skill", description: "Uses a safe asset." } });
  await assert.rejects(
    manager.saveAsset(maya, draft.id, { path: "assets/../../.env", data: Buffer.from("secret").toString("base64") }),
    (error) => error instanceof BuilderError && ["invalid_path", "unsafe_path", "invalid_package_path"].includes(error.code),
  );
});

test("publication rejects asset descriptors forged through a collaborative update", async (t) => {
  const { manager } = await fixture(t);
  const draft = await manager.create(maya, { kind: "skill", initial: { name: "Asset skill", description: "Uses a safe asset." } });
  const socket = new EventEmitter();
  socket.OPEN = 1;
  socket.readyState = 1;
  socket.send = () => undefined;
  socket.close = () => socket.emit("close");
  await manager.connect(maya, draft.id, socket);

  const local = new Y.Doc();
  const current = await manager.get(maya, draft.id);
  Y.applyUpdate(local, Buffer.from(current.update, "base64"));
  local.getMap("assets").set("assets/icon.png", { hash: "../../credentials", size: 32, mimeType: "image/png" });
  socket.emit("message", Buffer.from(JSON.stringify({ type: "update", update: Buffer.from(Y.encodeStateAsUpdate(local)).toString("base64") })));

  await assert.rejects(manager.publish(maya, draft.id), (error) => error instanceof BuilderError && error.code === "invalid_asset");
  local.destroy();
});

test("Yjs character updates converge without last-write-wins replacement", () => {
  const first = new Y.Doc();
  const second = new Y.Doc();
  first.getText("source").insert(0, "skill");
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
  first.getText("source").insert(5, " one");
  second.getText("source").insert(0, "team ");
  const firstUpdate = Y.encodeStateAsUpdate(first);
  const secondUpdate = Y.encodeStateAsUpdate(second);
  Y.applyUpdate(first, secondUpdate);
  Y.applyUpdate(second, firstUpdate);
  assert.equal(first.getText("source").toString(), second.getText("source").toString());
  assert.match(first.getText("source").toString(), /team/);
  assert.match(first.getText("source").toString(), /one/);
});
