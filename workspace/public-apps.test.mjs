import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";

import { attachPublicAppWebSocket, publicAppPath, proxyPublicApp } from "./public-apps.mjs";

test("accepts one app label and rejects ambiguous internal paths", () => {
  assert.deepEqual(publicAppPath("/__alshival_app/site/assets/main.js?x=1"),
    { slug: "site", relative: "/assets/main.js?x=1" });
  for (const name of ["", "a.b", "bad_name", "UPPER"]) {
    assert.equal(publicAppPath(`/__alshival_app/${name}/` ).invalid, true);
  }
  assert.equal(publicAppPath("/__alshival_app/site/%2e%2e/control").invalid, true);
});

test("forwards only a registered app in the dedicated range", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "neural-labs-apps-"));
  const config = path.join(root, ".neural-labs");
  await mkdir(config);
  let app;
  let port;
  for (let candidate = 30000; candidate <= 30050; candidate++) {
    app = createServer((request, response) => response.writeHead(200, { "content-type": "text/plain" }).end(
      `${request.headers.host}|${request.headers.authorization ?? "none"}|${request.url}`));
    try { await new Promise((resolve, reject) => app.once("error", reject).listen(candidate, "127.0.0.1", resolve)); port = candidate; break; }
    catch { app.close(); }
  }
  assert.ok(port, "one test app port is available");
  const gateway = createServer((request, response) => {
    void proxyPublicApp(request, response, { workspaceRoot: root,
      publicOrigin: "https://workspace.alshival.cloud", gated: () => false });
  });
  await new Promise(resolve => gateway.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${gateway.address().port}`;
  try {
    assert.equal((await fetch(`${origin}/__alshival_app/site/`)).status, 404);
    await writeFile(path.join(config, "public-apps.json"), JSON.stringify({ apps: { site: { port: 8792 } } }));
    assert.equal((await fetch(`${origin}/__alshival_app/site/`)).status, 404);
    await writeFile(path.join(config, "public-apps.json"), JSON.stringify({ apps: { site: { port } } }));
    const response = await fetch(`${origin}/__alshival_app/site/hello?q=1`,
      { headers: { Authorization: "Bearer portal-secret" } });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "site.workspace.alshival.cloud|none|/hello?q=1");
  } finally {
    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
    await new Promise(resolve => app.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("websocket upgrades stay on the selected application host", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "neural-labs-app-socket-"));
  await mkdir(path.join(root, ".neural-labs"));
  let backend;
  let port;
  for (let candidate = 30000; candidate <= 30050; candidate++) {
    backend = createServer();
    try { await new Promise((resolve, reject) => backend.once("error", reject).listen(candidate, "127.0.0.1", resolve)); port = candidate; break; }
    catch { backend.close(); }
  }
  assert.ok(port);
  const sockets = new WebSocketServer({ server: backend });
  sockets.on("connection", socket => socket.send("ready"));
  await writeFile(path.join(root, ".neural-labs", "public-apps.json"), JSON.stringify({ apps: { site: { port } } }));
  const gateway = createServer();
  attachPublicAppWebSocket(gateway, { workspaceRoot: root,
    publicOrigin: "https://workspace.alshival.cloud", gated: () => false });
  await new Promise(resolve => gateway.listen(0, "127.0.0.1", resolve));
  try {
    const client = new WebSocket(`ws://127.0.0.1:${gateway.address().port}/__alshival_app/site/socket`,
      { origin: "https://site.workspace.alshival.cloud" });
    const message = await new Promise((resolve, reject) => {
      client.once("message", value => resolve(String(value)));
      client.once("error", reject);
    });
    assert.equal(message, "ready");
    client.close();
  } finally {
    sockets.close();
    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
    await new Promise(resolve => backend.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
