import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { authenticateWorkspaceRequest, authorizeWorkspaceHttpRequest } from "./native/request-auth.mjs";

const secret = "fixture-only-secret-".repeat(3);
function fixture(overrides = {}) {
  const value = { actor: "member", email: "fixture@example.com", role: "user", session: createHash("sha256").update("fixture-session").digest("base64url"),
    uri: "/workspace/api/files?path=fixture", method: "GET", expires: 5100, ...overrides };
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`workspace-request-v1\n${payload}`).digest("base64url");
  return { url: value.uri, method: "GET", headers: { "x-neural-labs-assertion": `v1.${payload}.${signature}`,
    "x-forwarded-user": "forged-admin", "x-neural-labs-role": "admin", cookie: "private-session", authorization: "private-token" } };
}
test("workspace proxy identity requires a signed unexpired request and strips credentials before app dispatch", () => {
  const request = fixture();
  const actor = authenticateWorkspaceRequest(request, secret, 100);
  assert.equal(actor.actor, "member"); assert.equal(request.headers["x-forwarded-user"], "member");
  assert.equal(request.headers["x-neural-labs-role"], "user");
  for (const key of ["cookie", "authorization", "x-neural-labs-assertion"]) assert.equal(request.headers[key], undefined);
  for (const mutate of [r => delete r.headers["x-neural-labs-assertion"], r => r.method = "POST",
    r => r.url = "/workspace/api/files?path=other", r => r.headers["x-neural-labs-assertion"] += "x"]) {
    const forged = fixture(); mutate(forged); assert.throws(() => authenticateWorkspaceRequest(forged, secret, 100));
  }
  assert.throws(() => authenticateWorkspaceRequest(fixture({ session: "a".repeat(64) }), secret, 100), /does not match/);
  assert.throws(() => authenticateWorkspaceRequest(fixture(), secret, 5100), /expired/);
  assert.throws(() => authenticateWorkspaceRequest(fixture({ expires: 10000 }), secret, 100), /expired/);
});

test("opaque preview and editor frames cannot inherit identity or bypass protected paths", () => {
  for (const url of ["/workspace/preview/opaque/index.html", "/workspace/image-editor/index.html"]) {
    const request = { ...fixture(), url };
    assert.equal(authorizeWorkspaceHttpRequest(request, secret), null);
    assert.deepEqual(request.headers, {});
  }
  for (const url of ["/workspace/preview/../../workspace/api/files", "/workspace/image-editor/../api/files", "/workspace/api/files"]) {
    assert.throws(() => authorizeWorkspaceHttpRequest({ url, method: "GET", headers: {} }, secret), /authorization/);
  }
  assert.throws(() => authorizeWorkspaceHttpRequest({ url: "/workspace/preview/token", method: "POST", headers: {} }, secret));
});
