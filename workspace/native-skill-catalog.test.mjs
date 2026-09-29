import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { NativeSkillCatalog } from "./native/skill-catalog.mjs";

const content = Buffer.from("---\nname: fixture\ndescription: Synthetic skill\n---\nRun fixture only.\n");
const entry = { path: "SKILL.md", size: content.length, sha256: createHash("sha256").update(content).digest("hex") };
function fixture() {
  const requests = [], saved = [];
  const routes = {
    "/api/v1/search": { results: [{ slug: "fixture", ownerHandle: "publisher", version: "1.2.3" }] },
    "/api/v1/skills/fixture": { skill: { slug: "fixture", displayName: "Fixture", summary: "Synthetic package" }, owner: { handle: "publisher" }, latestVersion: { version: "1.2.3" } },
    "/api/v1/skills/fixture/versions/1.2.3": { version: { version: "1.2.3", files: [entry] } },
    "/api/v1/skills/fixture/file": content,
  };
  const catalog = new NativeSkillCatalog({ request: async (url, options) => {
    requests.push({ url, options }); const body = routes[url.pathname];
    return new Response(Buffer.isBuffer(body) ? body : JSON.stringify(body), { status: body ? 200 : 404 });
  } });
  return { catalog, requests, routes, saved, manager: { savePackage: async (...args) => { saved.push(args); return { key: "fixture" }; } } };
}
test("portable public catalog imports exact package bytes and records publisher/version provenance", async () => {
  const f = fixture(), actor = { role: "admin", id: "fixture-actor" };
  const found = await f.catalog.search("fixture");
  assert.equal(found.results[0].installRef, "publisher/fixture");
  assert.equal(found.results[0].sourceUrl, "https://clawhub.ai/publisher/skills/fixture");
  await f.catalog.search("fixture"); assert.equal(f.requests.length, 1);
  await f.catalog.install(actor, { slug: "publisher/fixture", version: "1.2.3" }, f.manager);
  assert.equal(f.saved.length, 1);
  const [savedActor, pkg, prior, provenance] = f.saved[0];
  assert.equal(savedActor, actor); assert.equal(prior, undefined);
  assert.deepEqual(pkg.files[0].content, content); assert.equal(pkg.fields.scope, "team");
  assert.deepEqual(provenance.files, [entry]); assert.equal(provenance.owner, "publisher");
  for (const { url, options } of f.requests) {
    assert.equal(url.origin, "https://clawhub.ai"); assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, undefined);
    if (url.pathname.includes("/skills/")) assert.equal(url.searchParams.get("ownerHandle"), "publisher");
  }
});
test("unprivileged, unpinned, ambiguous, traversal and corrupt imports never publish a partial package", async () => {
  const admin = { role: "admin" }, selection = { slug: "publisher/fixture", version: "1.2.3" };
  for (const mutate of [
    f => { f.routes["/api/v1/skills/fixture"].owner.handle = "someone-else"; },
    f => { f.routes["/api/v1/skills/fixture/versions/1.2.3"].version.files = [{ ...entry, path: "../SKILL.md" }]; },
    f => { f.routes["/api/v1/skills/fixture/file"] = Buffer.from("changed"); },
    f => { f.routes["/api/v1/skills/fixture"].moderation = { isMalwareBlocked: true }; },
  ]) {
    const f = fixture(); mutate(f); await assert.rejects(f.catalog.install(admin, selection, f.manager)); assert.equal(f.saved.length, 0);
  }
  const f = fixture();
  await assert.rejects(f.catalog.install({ role: "user" }, selection, f.manager), /administrators/);
  await assert.rejects(f.catalog.install(admin, { ...selection, version: "latest" }, f.manager), /exact/);
  await assert.rejects(f.catalog.detail("https://127.0.0.1/private"), /publisher-qualified/);
  assert.equal(f.requests.length, 0);
});
test("registry rate limits suppress follow-up traffic until Retry-After expires", async () => {
  let now = 0, calls = 0;
  const catalog = new NativeSkillCatalog({ now: () => now, request: async () => { calls++; return new Response("limited", { status: 429, headers: { "retry-after": "120" } }); } });
  await assert.rejects(catalog.search("fixture"));
  await assert.rejects(catalog.search("different"), /wait/); assert.equal(calls, 1);
  now = 120001; await assert.rejects(catalog.search("fixture")); assert.equal(calls, 2);
});
