import http from "node:http";

export const VSCODE_BASE_PATH = "/workspace/vscode";

const responseHeaderBlocklist = new Set([
  "connection",
  "content-security-policy",
  "keep-alive",
  "proxy-authenticate",
  "referrer-policy",
  "set-cookie",
  "transfer-encoding",
  "upgrade",
  "x-frame-options",
]);

export function proxyVsCodeHttp(request, response, config) {
  if (!workspaceActor(request.headers)) {
    sendText(response, 401, "Authentication is required\n", request.method);
    return;
  }
  if (isExactBase(request.url, config.publicOrigin)) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Location", `${VSCODE_BASE_PATH}/`);
    response.setHeader("Content-Length", "0");
    response.writeHead(308);
    response.end();
    return;
  }
  if (isMutation(request.method) && request.headers.origin !== config.publicOrigin) {
    sendText(response, 403, "A same-origin request is required\n", request.method);
    return;
  }

  const upstream = createUpstreamRequest(request, config, (upstreamResponse) => {
    response.statusCode = upstreamResponse.statusCode || 502;
    for (const [name, value] of Object.entries(upstreamResponse.headers)) {
      if (value !== undefined && !responseHeaderBlocklist.has(name.toLowerCase())) {
        response.setHeader(name, value);
      }
    }
    hardenVsCodeResponse(response, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.once("error", () => {
    if (!response.headersSent) {
      sendText(response, 503, "VS Code is starting. Try again in a moment.\n", request.method);
    } else {
      response.destroy();
    }
  });
  request.pipe(upstream);
}

export function attachVsCodeWebSocketBridge(server, config) {
  const sockets = new Set();
  const onUpgrade = (request, socket, head) => {
    if (!isVsCodePath(request.url, config.publicOrigin)) return;
    if (!workspaceActor(request.headers)) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    if (request.headers.origin !== config.publicOrigin) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    const upstream = createUpstreamRequest(request, config);
    upstream.once("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
      sockets.add(socket);
      sockets.add(upstreamSocket);
      const forgetSockets = () => {
        sockets.delete(socket);
        sockets.delete(upstreamSocket);
      };
      socket.once("close", forgetSockets);
      upstreamSocket.once("close", forgetSockets);
      socket.write(
        `HTTP/1.1 ${upstreamResponse.statusCode || 101} ${upstreamResponse.statusMessage || "Switching Protocols"}\r\n` +
          Object.entries(upstreamResponse.headers)
            .filter(([name]) => !["proxy-authenticate", "set-cookie"].includes(name.toLowerCase()))
            .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`)
            .join("\r\n") +
          "\r\n\r\n",
      );
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
    });
    upstream.once("response", (upstreamResponse) => {
      upstreamResponse.resume();
      rejectUpgrade(socket, upstreamResponse.statusCode || 502, "Upstream Rejected Upgrade");
    });
    upstream.once("error", () => rejectUpgrade(socket, 503, "Service Unavailable"));
    upstream.end();
  };

  server.on("upgrade", onUpgrade);
  return {
    close() {
      server.off("upgrade", onUpgrade);
      for (const socket of sockets) socket.destroy();
      sockets.clear();
    },
  };
}

function hardenVsCodeResponse(response, upstreamHeaders) {
  const rawPolicy = upstreamHeaders["content-security-policy"];
  const policy = Array.isArray(rawPolicy) ? rawPolicy.join("; ") : String(rawPolicy || "");
  const framedPolicy = /(?:^|;)\s*frame-ancestors\b/i.test(policy)
    ? policy.replace(/(^|;)\s*frame-ancestors\b[^;]*/gi, "$1 frame-ancestors 'self'")
    : `${policy ? `${policy}; ` : ""}frame-ancestors 'self'`;
  response.setHeader("Content-Security-Policy", framedPolicy);
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
}

function createUpstreamRequest(request, config, onResponse) {
  const target = validatedCodeServerOrigin(config.codeServerOrigin);
  const headers = { ...request.headers };
  delete headers.authorization;
  delete headers.cookie;
  delete headers["x-forwarded-user"];
  delete headers["x-neural-labs-email"];
  delete headers["x-neural-labs-role"];
  // code-server compares the WebSocket Origin with Host. Retain the public
  // Host while the TCP connection itself remains pinned to loopback.
  headers.host = headers.host || new URL(config.publicOrigin).host;
  headers["x-forwarded-host"] = headers.host;
  headers["x-forwarded-proto"] = new URL(config.publicOrigin).protocol.replace(":", "");
  headers["x-forwarded-prefix"] = VSCODE_BASE_PATH;
  return http.request({
    hostname: target.hostname,
    port: target.port,
    method: request.method,
    path: normalizeUpstreamPath(request.url, config.publicOrigin),
    headers,
  }, onResponse);
}

function validatedCodeServerOrigin(value) {
  const target = new URL(value || "http://127.0.0.1:18881");
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || !target.port || target.pathname !== "/") {
    throw new Error("code-server must use an explicit 127.0.0.1 HTTP origin");
  }
  return target;
}

function normalizeUpstreamPath(value, origin) {
  const url = new URL(String(value || "/"), origin);
  url.pathname = url.pathname.slice(VSCODE_BASE_PATH.length) || "/";
  return `${url.pathname}${url.search}`;
}

function isVsCodePath(value, origin) {
  try {
    const pathname = new URL(String(value || "/"), origin).pathname;
    return pathname === VSCODE_BASE_PATH || pathname.startsWith(`${VSCODE_BASE_PATH}/`);
  } catch {
    return false;
  }
}

function isExactBase(value, origin) {
  try {
    return new URL(String(value || "/"), origin).pathname === VSCODE_BASE_PATH;
  } catch {
    return false;
  }
}

function workspaceActor(headers) {
  return typeof headers["x-forwarded-user"] === "string" && Boolean(headers["x-forwarded-user"].trim());
}

function isMutation(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(method || "GET");
}

function sendText(response, status, body, method) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.writeHead(status);
  response.end(method === "HEAD" ? undefined : body);
}

function rejectUpgrade(socket, status, reason) {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
