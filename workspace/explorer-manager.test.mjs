import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createFileManager } from "./file-manager.mjs";
import { createExplorerManager } from "./explorer-manager.mjs";

async function fixture(t) {
  const home = await mkdtemp(path.join(tmpdir(), "neural-files-test-"));
  const root = path.join(home, "workspace");
  await mkdir(root);
  const files = createFileManager({ root, maxUploadBytes: 10000 });
  let time = Date.now();
  const events = [];
  const manager = createExplorerManager({
    files,
    root,
    now: () => time,
    changed: (e) => events.push(e),
  });
  await manager.ready;
  t.after(async () => {
    await manager.close();
    await rm(home, { recursive: true, force: true });
  });
  async function run(items, user = "alice") {
    const queued = manager.enqueue(user, { items });
    let job;
    do {
      await new Promise((r) => setTimeout(r, 5));
      job = manager.operation(user, queued.id);
    } while (["queued", "running"].includes(job.state));
    return job;
  }
  return {
    root,
    files,
    manager,
    run,
    events,
    advance(days) {
      time += days * 86400000;
    },
  };
}
test("sorts by file extension and resolves same-directory copy conflicts", async (t) => {
  const { root, manager, run } = await fixture(t);
  await writeFile(path.join(root, "first.txt"), "one");
  await writeFile(path.join(root, "second.png"), "two");
  const sorted = await manager.list("", { sort: "type" });
  assert.deepEqual(
    sorted.entries.map((e) => e.name),
    ["second.png", "first.txt"],
  );
  const blocked = await run([
    { action: "copy", path: "first.txt", destination: "" },
  ]);
  assert.equal(blocked.results[0].code, "already_exists");
  const copied = await run([
    {
      action: "copy",
      path: "first.txt",
      destination: "",
      conflict: "keep-both",
    },
  ]);
  assert.equal(copied.results[0].status, "completed");
  assert.equal(await readFile(path.join(root, "first (2).txt"), "utf8"), "one");
  await manager.close();
  const restarted = createExplorerManager({
    files: createFileManager({ root }),
    root,
  });
  await restarted.ready;
  assert.equal(
    restarted.operation("alice", copied.id).results[0].status,
    "completed",
  );
  assert.deepEqual(restarted.operations("bob").operations, []);
  await restarted.close();
});

test("pins persist per user, reject stale updates, and follow renamed folders", async (t) => {
  const { root, manager, run } = await fixture(t);
  await mkdir(path.join(root, "projects"));
  await manager.saveMetadata("alice", {
    revision: 0,
    pins: [{ path: "projects", label: "Projects" }],
  });
  assert.deepEqual((await manager.metadata("bob")).pins, []);
  await assert.rejects(
    manager.saveMetadata("alice", { revision: 0, pins: [] }),
    { code: "stale_metadata" },
  );
  const job = await run([
    { action: "rename", path: "projects", name: "work", destination: "" },
  ]);
  assert.equal(job.results[0].status, "completed");
  assert.equal((await manager.metadata("alice")).pins[0].path, "work");
});
test("search is recursive, scoped, paginated, hidden-aware, and private", async (t) => {
  const { root, manager } = await fixture(t);
  await mkdir(path.join(root, "folder"));
  await writeFile(path.join(root, "folder", "report.txt"), "hi");
  await writeFile(path.join(root, ".report"), "hidden");
  assert.equal(
    (await manager.search("a", { q: "report", scope: "recursive", path: "" }))
      .entries.length,
    1,
  );
  assert.equal(
    (await manager.search("a", { q: "report", scope: "direct", path: "" }))
      .entries.length,
    0,
  );
  assert.equal(
    (await manager.search("a", { q: "report", hidden: "true", path: "" }))
      .entries.length,
    2,
  );
  await assert.rejects(manager.search("b", { q: "x", cursor: "unknown" }), {
    code: "expired_search",
  });
});
test("trash is recoverable by teammates and expires at 90 days", async (t) => {
  const { root, manager, run, advance } = await fixture(t);
  await writeFile(path.join(root, "note.txt"), "original");
  await run([{ action: "trash", path: "note.txt" }]);
  const item = (await manager.trash()).entries[0];
  assert.equal(item.deletedBy, "alice");
  await assert.rejects(access(path.join(root, "note.txt")));
  const restored = await run([{ action: "restore", id: item.id }], "bob");
  assert.equal(restored.results[0].status, "completed");
  assert.equal(await readFile(path.join(root, "note.txt"), "utf8"), "original");
  await run([{ action: "trash", path: "note.txt" }]);
  advance(89);
  await manager.maintain();
  assert.equal((await manager.trash()).entries.length, 1);
  advance(1);
  await manager.maintain();
  assert.equal((await manager.trash()).entries.length, 0);
});
test("replace preserves previous contents and keep-both never overwrites", async (t) => {
  const { root, run, manager } = await fixture(t);
  await mkdir(path.join(root, "target"));
  await writeFile(path.join(root, "a.txt"), "new");
  await writeFile(path.join(root, "target/a.txt"), "old");
  assert.equal(
    (await run([{ action: "copy", path: "a.txt", destination: "target" }]))
      .results[0].code,
    "already_exists",
  );
  assert.equal(
    (
      await run([
        {
          action: "copy",
          path: "a.txt",
          destination: "target",
          conflict: "keep-both",
        },
      ])
    ).results[0].destination,
    "target/a (2).txt",
  );
  await run([
    {
      action: "move",
      path: "a.txt",
      destination: "target",
      conflict: "replace",
    },
  ]);
  assert.equal(await readFile(path.join(root, "target/a.txt"), "utf8"), "new");
  assert.equal((await manager.trash()).entries[0].reason, "replaced");
});
test("refuses traversal, root deletion, nested destinations and symlink descendants", async (t) => {
  const { root, run } = await fixture(t);
  await mkdir(path.join(root, "source"));
  await symlink("/etc/passwd", path.join(root, "source/link"));
  for (const item of [
    { action: "trash", path: "" },
    { action: "trash", path: "../other" },
    { action: "copy", path: "source", destination: "source" },
    { action: "trash", path: "source" },
  ]) {
    assert.equal((await run([item])).results[0].status, "failed");
  }
  await access(path.join(root, "source/link"));
});
test("binary saves detect stale versions and preserve originals in Trash", async (t) => {
  const { root, manager, files } = await fixture(t);
  await writeFile(path.join(root, "image.png"), "old");
  const version = (await files.list("")).entries[0].version;
  await writeFile(path.join(root, "image.png"), "external");
  await assert.rejects(
    manager.upload(
      "alice",
      "",
      "image.png",
      Readable.from([Buffer.from("edit")]),
      { version },
    ),
    { code: "stale_file" },
  );
  const currentVersion = (await files.list("")).entries[0].version;
  const saved = await manager.upload(
    "alice",
    "",
    "image.png",
    Readable.from([Buffer.from("edit")]),
    { version: currentVersion },
  );
  assert.equal(saved.item.size, 4);
  assert.equal((await manager.trash()).entries.length, 1);
});
test("cancelled and oversized uploads leave no partial files", async (t) => {
  const { root, manager } = await fixture(t);
  await assert.rejects(
    manager.upload("a", "", "large.png", Readable.from([Buffer.alloc(10001)])),
    { code: "upload_too_large" },
  );
  const broken = Readable.from(
    (async function* () {
      yield Buffer.from("part");
      throw new Error("disconnected");
    })(),
  );
  await assert.rejects(
    manager.upload("a", "", "part.png", broken),
    /disconnected/,
  );
  assert.deepEqual(await readdir(root), []);
});
test("operation state is user-scoped and queued work can be cancelled", async (t) => {
  const { root, manager } = await fixture(t);
  await writeFile(path.join(root, "file.txt"), "hi");
  const queued = manager.enqueue("alice", {
    items: [{ action: "copy", path: "file.txt", name: "copy.txt" }],
  });
  assert.throws(() => manager.operation("bob", queued.id), {
    code: "not_found",
  });
  manager.operation("alice", queued.id, true);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(manager.operation("alice", queued.id).state, "cancelled");
  await assert.rejects(access(path.join(root, "copy.txt")));
});
test("folder ZIP downloads are scoped and include nested content", async (t) => {
  const { root, manager, run } = await fixture(t);
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs/readme.txt"), "hello");
  const job = await run([{ action: "archive", paths: ["docs"] }]);
  assert.equal(job.results[0].status, "completed");
  await assert.rejects(manager.downloadArchive("bob", job.id), {
    code: "not_found",
  });
  const archive = await manager.downloadArchive("alice", job.id);
  const chunks = [];
  for await (const chunk of archive.stream) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.readUInt16LE(0), 0x4b50);
  assert.ok(bytes.includes(Buffer.from("docs/readme.txt")));
  await archive.cleanup();
});
test("restore conflicts preserve both trash and current files", async (t) => {
  const { root, manager, run } = await fixture(t);
  await writeFile(path.join(root, "note.txt"), "old");
  await run([{ action: "trash", path: "note.txt" }]);
  const item = (await manager.trash()).entries[0];
  await writeFile(path.join(root, "note.txt"), "new");
  assert.equal(
    (await run([{ action: "restore", id: item.id }])).results[0].code,
    "already_exists",
  );
  assert.equal((await manager.trash()).entries.length, 1);
  assert.equal(await readFile(path.join(root, "note.txt"), "utf8"), "new");
  await run([{ action: "restore", id: item.id, conflict: "keep-both" }]);
  assert.equal(await readFile(path.join(root, "note (2).txt"), "utf8"), "old");
});
