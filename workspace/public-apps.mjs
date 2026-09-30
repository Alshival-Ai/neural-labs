// Workspace-local HTTP ingress for explicitly registered public applications.

import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import path from "node:path";

const PREFIX = "/__alshival_app/";
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
const REQUEST = new Set(["accept", "accept-encoding", "accept-language", "content-type", "content-length", "cookie", "if-none-match", "if-modified-since", "range", "if-range", "origin", "referer", "user-agent"]);

export function publicAppPath(rawUrl) {
  if (!rawUrl?.startsWith(PREFIX)) return null;
  const rest = rawUrl.slice(PREFIX.length);
  const separator = rest.indexOf("/");
  if (separator < 1 || !LABEL.test(rest.slice(0, separator))) return { invalid: true };
  const slug = rest.slice(0, separator);
  const relative = rest.slice(separator);
  if (relative.startsWith("//") || relative.includes("\\") || /%(?:2e|2f|5c)/i.test(relative)) return { invalid: true };
  return { slug, relative };
}

async function portFor(root, slug) {
  let data;
  try {
    const content = await readFile(path.join(root, ".neural-labs", "public-apps.json"));
    if (content.length > 65536) return null;
    data = JSON.parse(content.toString("utf8"));
  } catch { return null; }
  const port = data?.apps?.[slug]?.port;
  // A dedicated range prevents an app name from targeting the desktop, MCP,
  // editor, or other control listeners inside the container.
  return Number.isInteger(port) && port >= 30000 && port <= 30999 ? port : null;
}

function appOrigin(slug, publicOrigin, local) {
  const base = new URL(typeof publicOrigin === "function" ? publicOrigin() : publicOrigin);
  return local ? base.origin : `https://${slug}.${base.host}`;
}
function requestHeaders(incoming, slug, publicOrigin, local) {
  const base = new URL(appOrigin(slug, publicOrigin, local));
  const headers = { host: base.host, "x-forwarded-proto": base.protocol.slice(0, -1) };
  for (const [key, value] of Object.entries(incoming)) {
    if (REQUEST.has(key) && typeof value === "string") headers[key] = value;
  }
  return headers;
}

export async function proxyPublicApp(request, response, { workspaceRoot, publicOrigin, gated, resolvePort, local = false }) {
  const parsed = publicAppPath(request.url);
  if (!parsed) return false;
  response.setHeader("X-Neural-Labs-App-Gateway", "ready");
  if (parsed.invalid || gated?.()) { response.writeHead(parsed.invalid ? 404 : 503).end(); return true; }
  const port = (resolvePort ? await resolvePort(parsed.slug) : await portFor(workspaceRoot, parsed.slug));
  if (!port) { response.writeHead(404).end(); return true; }
  const upstream = httpRequest({ hostname: "127.0.0.1", port, method: request.method,
    path: parsed.relative, headers: requestHeaders(request.headers, parsed.slug, publicOrigin, local), timeout: 30000 }, incoming => {
    const headers = {};
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (!HOP.has(key) && key !== "server" && value !== undefined) headers[key] = value;
    }
    response.writeHead(incoming.statusCode || 502, headers);
    incoming.pipe(response);
  });
  upstream.on("timeout", () => upstream.destroy());
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502).end();
    else response.destroy();
  });
  request.on("aborted", () => upstream.destroy());
  request.pipe(upstream);
  return true;
}

export function attachPublicAppWebSocket(server, { workspaceRoot, publicOrigin, gated, resolvePort, local = false }) {
  server.on("upgrade", async (request, socket, head) => {
    const parsed = publicAppPath(request.url);
    if (!parsed) return;
    if (parsed.invalid || gated?.()) { socket.destroy(); return; }
    const expected = appOrigin(parsed.slug, publicOrigin, local);
    if (request.headers.origin !== expected) { socket.destroy(); return; }
    const port = (resolvePort ? await resolvePort(parsed.slug) : await portFor(workspaceRoot, parsed.slug));
    if (!port) { socket.destroy(); return; }
    const headers = { ...requestHeaders(request.headers, parsed.slug, publicOrigin, local),
      connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": request.headers["sec-websocket-key"],
      "sec-websocket-version": request.headers["sec-websocket-version"] };
    if (request.headers["sec-websocket-protocol"]) headers["sec-websocket-protocol"] = request.headers["sec-websocket-protocol"];
    const upstream = httpRequest({ hostname: "127.0.0.1", port, path: parsed.relative, headers });
    upstream.on("upgrade", (response, target, targetHead) => {
      socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n`);
      for (const [key, value] of Object.entries(response.headers)) {
        if (value !== undefined && !["set-cookie", "server"].includes(key)) socket.write(`${key}: ${value}\r\n`);
      }
      socket.write("\r\n");
      if (targetHead.length) socket.write(targetHead);
      if (head.length) target.write(head);
      socket.pipe(target).pipe(socket);
      target.on("error", () => socket.destroy());
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    upstream.end();
  });
}
