import test from "node:test";
import assert from "node:assert/strict";
import { NativeTools } from "./native/tools.mjs";

function fixture(t) {
  let authorized = true, closed = 0, dispatched = 0, transport, authorizeTool;
  const requests = [];
  const tools = new NativeTools({ origin: "http://127.0.0.1:8792", configuration: {},
    request: async (...args) => { requests.push(args); return {}; },
    createApplication: (_config, send, _status, check) => {
      transport = send;
      authorizeTool = check;
      return { app: req => { dispatched++; assert.equal(req.headers.authorization, undefined); }, close: async () => { closed++; } };
    } });
  t.after(() => tools.close());
  const grant = { revalidate: async () => { if (!authorized) throw new Error("revoked"); } };
  const response = () => ({ headersSent: false, writeHead(status) { this.status = status; return this; }, end() {}, destroy() {} });
  return { tools, grant, response, revoke: () => { authorized = false; }, closed: () => closed,
    dispatched: () => dispatched, transport: (...args) => transport(...args), requests, check: name => authorizeTool(name) };
}

test("native tools accept only a live execution capability and consume its bearer", async t => {
  const f = fixture(t), session = await f.tools.mint(f.grant);
  const auth = session.codex.http_headers.Authorization;
  assert.equal(session.claude.mcpServers["neural-labs"].headers.Authorization, auth);
  for (const [url, authorization] of [["/healthz", auth], ["/mcp", "Bearer invented"], ["/mcp", undefined]]) {
    const res = f.response(); await f.tools.handle({ url, headers: { authorization } }, res); assert.equal(res.status, 401);
  }
  await f.tools.handle({ url: "/mcp", headers: { authorization: auth } }, f.response());
  assert.equal(f.dispatched(), 1);
  f.revoke();
  const res = f.response(); await f.tools.handle({ url: "/mcp", headers: { authorization: auth } }, res);
  assert.equal(res.status, 403); assert.equal(f.dispatched(), 1);
  await assert.rejects(f.transport("https://example.com", {}), /revoked/);
  await session.release(); assert.equal(f.closed(), 1);
  const released = f.response(); await f.tools.handle({ url: "/mcp", headers: { authorization: auth } }, released);
  assert.equal(released.status, 401);
});

test("read-only native execution denies modifying tools and rechecks revocation on invocation", async t => {
  const f = fixture(t), session = await f.tools.mint({ ...f.grant, policy: { sandbox: "read-only" } });
  await f.check("read_terminal");
  for (const tool of ["open_terminal", "send_terminal_input", "pexels_download_media", "notify_workspace_user", "future_tool"])
    await assert.rejects(f.check(tool), /execution policy/);
  await session.release();
  await assert.rejects(f.check("read_terminal"), /ended/);
});

test("automation tool capabilities cannot stage notifications against another job or occurrence", async t => {
  const f = fixture(t); await f.tools.mint({ ...f.grant, jobId: "job-1", occurrenceId: "run-1" });
  const endpoint = "http://control-plane:4174/internal/notifications/send";
  for (const body of [{ automationId: "job-2" }, { automationId: "job-1", runId: "run-2" }, { userId: "someone" }]) {
    await assert.rejects(f.transport(endpoint, { body: JSON.stringify(body) }), /target/);
  }
  await f.transport(endpoint, { body: JSON.stringify({ automationId: "job-1", runId: "run-1" }) });
  assert.equal(f.requests.length, 1);
});

test("a held delivery policy rejects sends without disabling read-only integration tools", async t => {
  const f = fixture(t); let enabled = false;
  await f.tools.mint({ ...f.grant, deliveryEnabled: () => enabled });
  await assert.rejects(f.transport("http://control-plane:4174/internal/notifications/send", {}), /delivery is disabled/);
  assert.equal(f.requests.length, 0);
  await f.transport("https://maps.googleapis.com/maps/api/geocode/json", {});
  enabled = true;
  await f.transport("http://control-plane:4174/internal/notifications/send", {});
  assert.equal(f.requests.length, 2);
});
test("Team MCP proxy forwards only the active channel capability and closes on revocation", async t => {
  let authorized = true, upstream;
  const tools = new NativeTools({ origin: "http://127.0.0.1:8792", teamOrigin: "http://control-plane:4174",
    configuration: {}, createApplication: () => ({ app() {}, close: async () => {} }),
    request: async (url, init) => { upstream = { url: String(url), init }; return new Response(JSON.stringify({ result: {} }),
      { headers: { "Content-Type": "application/json" } }); } });
  t.after(() => tools.close());
  const session = await tools.mint({ team: { capability: "private-team-capability" },
    revalidate: async () => { if (!authorized) throw new Error("revoked"); } });
  assert.equal(session.codex.team.url, "http://127.0.0.1:8792/team-mcp");
  const request = async () => {
    const body = Buffer.from('{"jsonrpc":"2.0","method":"tools/list","id":1}');
    return { url: "/team-mcp", method: "POST", headers: { authorization: session.codex.http_headers.Authorization },
      async *[Symbol.asyncIterator]() { yield body; } };
  };
  const response = { status: 0, headers: {}, body: undefined,
    writeHead(status, headers) { this.status = status; this.headers = headers; return this; },
    end(body) { this.body = body; } };
  await tools.handle(await request(), response);
  assert.equal(response.status, 200);
  assert.equal(upstream.url, "http://control-plane:4174/internal/team-mcp");
  assert.equal(upstream.init.headers.Authorization, "Bearer private-team-capability");
  assert.equal(upstream.init.body.toString(), '{"jsonrpc":"2.0","method":"tools/list","id":1}');
  authorized = false;
  const denied = { ...response, status: 0, writeHead(status) { this.status = status; return this; }, end() {} };
  await tools.handle(await request(), denied);
  assert.equal(denied.status, 403);
  await session.release();
});


test("graph reads bind the execution actor and discard data after revocation", async t => {
  let callback, authorized = true, revokedDuringRead = false;
  const tools = new NativeTools({ origin: "http://127.0.0.1:8792", configuration: {},
    createApplication: (_config, _send, _status, _check, _browser, _deployments, read) => {
      callback = read; return { app() {}, async close() {} };
    },
    projectRead: async (actor, input) => {
      assert.equal(actor, "bound-member"); assert.deepEqual(input, {});
      if (revokedDuringRead) authorized = false;
      return { items: [{ id: "task" }] };
    },
  });
  t.after(() => tools.close());
  const session = await tools.mint({ actor: "bound-member", policy: { sandbox: "read-only" },
    revalidate: async () => { if (!authorized) throw new Error("revoked"); } });
  assert.deepEqual(await callback({}), { items: [{ id: "task" }] });
  revokedDuringRead = true;
  await assert.rejects(callback({}), /revoked/);
  authorized = true;
  await session.release();
  await assert.rejects(callback({}), /ended/);
});
