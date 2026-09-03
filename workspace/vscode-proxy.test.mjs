import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";

import { attachVsCodeWebSocketBridge, proxyVsCodeHttp } from "./vscode-proxy.mjs";

const publicOrigin = "https://neural-labs.example.com";
const actorHeaders = {
  Host: "neural-labs.example.com",
  Origin: publicOrigin,
  "X-Forwarded-User": "user-1",
  "X-Neural-Labs-Email": "ada@example.com",
};

test("proxies authenticated VS Code HTTP below the workspace path and permits same-origin framing", async (context) => {
  let received;
  const upstream = http.createServer((request, response) => {
    received = { headers: request.headers, url: request.url };
    response.writeHead(200, {
      "Content-Type": "text/plain",
      "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
      "Set-Cookie": "code-server-session=must-not-reach-the-browser",
      "X-Frame-Options": "DENY",
    });
    response.end("code-server-ok");
  });
  await listen(upstream);

  const proxy = http.createServer((request, response) => {
    proxyVsCodeHttp(request, response, {
      codeServerOrigin: `http://127.0.0.1:${upstream.address().port}`,
      publicOrigin,
    });
  });
  await listen(proxy);
  context.after(async () => {
    proxy.closeAllConnections?.();
    upstream.closeAllConnections?.();
    await Promise.all([close(proxy), close(upstream)]);
  });

  const response = await request(proxy.address().port, "/workspace/vscode/workbench?folder=%2Fhome%2Fnode%2Fworkspace", {
    ...actorHeaders,
    Cookie: "neural-labs-session=secret",
  });

  assert.equal(response.status, 200);
  assert.equal(response.body, "code-server-ok");
  assert.equal(response.headers["set-cookie"], undefined);
  assert.match(response.headers["content-security-policy"], /frame-ancestors 'self'/);
  assert.doesNotMatch(response.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(response.headers["x-frame-options"], "SAMEORIGIN");
  assert.equal(response.headers["x-robots-tag"], "noindex, nofollow, noarchive");
  assert.equal(received.url, "/workbench?folder=%2Fhome%2Fnode%2Fworkspace");
  assert.equal(received.headers.host, "neural-labs.example.com");
  assert.equal(received.headers["x-forwarded-host"], "neural-labs.example.com");
  assert.equal(received.headers["x-forwarded-prefix"], "/workspace/vscode");
  assert.equal(received.headers["x-forwarded-user"], undefined);
  assert.equal(received.headers["x-neural-labs-email"], undefined);
  assert.equal(received.headers.cookie, undefined);

  const redirect = await request(proxy.address().port, "/workspace/vscode", actorHeaders);
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.location, "/workspace/vscode/");

  const anonymous = await request(proxy.address().port, "/workspace/vscode/", { Host: "neural-labs.example.com" });
  assert.equal(anonymous.status, 401);
  const crossOriginPost = await request(proxy.address().port, "/workspace/vscode/callback", {
    ...actorHeaders,
    Origin: "https://attacker.example.com",
  }, "POST");
  assert.equal(crossOriginPost.status, 403);
});

test("bridges authenticated same-origin VS Code WebSockets with the public host intact", async (context) => {
  const upstream = http.createServer();
  const upstreamWebSockets = new WebSocketServer({ server: upstream });
  upstreamWebSockets.on("connection", (socket, request) => {
    socket.send(JSON.stringify({
      host: request.headers.host,
      origin: request.headers.origin,
      actor: request.headers["x-forwarded-user"],
    }));
  });
  await listen(upstream);

  const proxy = http.createServer((_request, response) => response.writeHead(404).end());
  const bridge = attachVsCodeWebSocketBridge(proxy, {
    codeServerOrigin: `http://127.0.0.1:${upstream.address().port}`,
    publicOrigin,
  });
  await listen(proxy);
  context.after(async () => {
    bridge.close();
    upstreamWebSockets.close();
    proxy.closeAllConnections?.();
    upstream.closeAllConnections?.();
    await Promise.all([close(proxy), close(upstream)]);
  });

  const client = new WebSocket(`ws://127.0.0.1:${proxy.address().port}/workspace/vscode/socket`, {
    headers: actorHeaders,
  });
  const [raw] = await once(client, "message");
  const received = JSON.parse(raw.toString("utf8"));
  assert.deepEqual(received, {
    host: "neural-labs.example.com",
    origin: publicOrigin,
  });
  client.close();
  await once(client, "close");
});

test("rejects anonymous and cross-origin VS Code WebSocket upgrades", async (context) => {
  const proxy = http.createServer((_request, response) => response.writeHead(404).end());
  const bridge = attachVsCodeWebSocketBridge(proxy, {
    codeServerOrigin: "http://127.0.0.1:9",
    publicOrigin,
  });
  await listen(proxy);
  context.after(async () => {
    bridge.close();
    proxy.closeAllConnections?.();
    await close(proxy);
  });

  assert.equal(await rejectedWebSocketStatus(
    `ws://127.0.0.1:${proxy.address().port}/workspace/vscode/socket`,
    { ...actorHeaders, Origin: "https://attacker.example.com" },
  ), 403);
  assert.equal(await rejectedWebSocketStatus(
    `ws://127.0.0.1:${proxy.address().port}/workspace/vscode/socket`,
    { Host: "neural-labs.example.com", Origin: publicOrigin },
  ), 404);
});

function listen(server) {
  server.listen(0, "127.0.0.1");
  return once(server, "listening");
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function request(port, requestPath, headers, method = "GET") {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ hostname: "127.0.0.1", port, path: requestPath, method, headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.once("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

function rejectedWebSocketStatus(url, headers) {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(url, { headers });
    client.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    client.once("open", () => reject(new Error("the WebSocket was unexpectedly accepted")));
    client.once("error", () => undefined);
  });
}
