const http = require("node:http");
const { setTimeout: delay } = require("node:timers/promises");

const {
  DOCKER_NETWORK,
  ensureWorkspaceScaffold,
  markWorkspaceActivitySafe,
  runDocker,
} = require("./workspace-runtime.js");

const VSCODE_PORT = Number.isFinite(
  Number.parseInt(process.env.NEURAL_LABS_VSCODE_PORT || "", 10)
)
  ? Number.parseInt(process.env.NEURAL_LABS_VSCODE_PORT || "", 10)
  : 13337;
const VSCODE_ENABLED = process.env.NEURAL_LABS_VSCODE_ENABLED !== "false";
const VSCODE_BASE_PATH = "/vscode";
const VSCODE_UPSTREAM_ORIGIN = `http://127.0.0.1:${VSCODE_PORT}`;
const VSCODE_START_TIMEOUT_MS = 15_000;

const startPromisesByUser = new Map();

function isVsCodePath(url) {
  try {
    const parsed = new URL(url || "/", "http://localhost");
    return parsed.pathname === VSCODE_BASE_PATH || parsed.pathname.startsWith(`${VSCODE_BASE_PATH}/`);
  } catch {
    return false;
  }
}

function isExactVsCodeBasePath(url) {
  try {
    const parsed = new URL(url || "/", "http://localhost");
    return parsed.pathname === VSCODE_BASE_PATH;
  } catch {
    return false;
  }
}

function normalizeProxyPath(url) {
  const parsed = new URL(url || "/", "http://localhost");
  let pathname = parsed.pathname.slice(VSCODE_BASE_PATH.length);
  if (!pathname) {
    pathname = "/";
  }
  parsed.pathname = pathname;
  return `${parsed.pathname}${parsed.search}`;
}

function sendPlain(res, statusCode, message) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(message);
}

function sendUnauthorized(res) {
  res.statusCode = 302;
  res.setHeader("location", "/login");
  res.end("Redirecting to login");
}

function sendUpgradeError(socket, statusCode, message) {
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(message)}\r\n` +
      "\r\n" +
      message
  );
  socket.destroy();
}

async function canReachCodeServer(containerName) {
  try {
    await runDocker([
      "exec",
      containerName,
      "sh",
      "-lc",
      `curl -fsS ${VSCODE_UPSTREAM_ORIGIN}/ >/dev/null`,
    ]);
    return true;
  } catch {
    return false;
  }
}

async function getContainerHost(containerName) {
  const ipAddress = await runDocker([
    "inspect",
    "--format",
    `{{with index .NetworkSettings.Networks "${DOCKER_NETWORK}"}}{{.IPAddress}}{{end}}`,
    containerName,
  ]);
  return ipAddress || containerName;
}

async function startCodeServer(workspace) {
  if (!workspace.containerName || !workspace.workspacePathInContainer) {
    throw new Error("Workspace container is not available for VS Code.");
  }

  if (await canReachCodeServer(workspace.containerName)) {
    return;
  }

  const workspacePath = workspace.workspacePathInContainer;
  const command = [
    `mkdir -p ${workspacePath}/.neural-labs`,
    `nohup code-server --bind-addr 0.0.0.0:${VSCODE_PORT} --auth none --disable-telemetry ${workspacePath} > ${workspacePath}/.neural-labs/code-server.log 2>&1 &`,
  ].join(" && ");

  await runDocker([
    "exec",
    "-d",
    "-w",
    workspacePath,
    "-e",
    `HOME=${workspacePath}`,
    "-e",
    "VSCODE_PROXY_URI=./proxy/{{port}}",
    workspace.containerName,
    "sh",
    "-lc",
    command,
  ]);

  const startedAt = Date.now();
  while (Date.now() - startedAt < VSCODE_START_TIMEOUT_MS) {
    if (await canReachCodeServer(workspace.containerName)) {
      return;
    }
    await delay(300);
  }

  throw new Error("VS Code did not become ready in time.");
}

async function ensureCodeServerForUser(userId) {
  if (!VSCODE_ENABLED) {
    throw new Error("VS Code is disabled for this Neural Labs instance.");
  }

  let promise = startPromisesByUser.get(userId);
  if (!promise) {
    promise = (async () => {
      markWorkspaceActivitySafe(userId);
      const workspace = await ensureWorkspaceScaffold(userId);
      await startCodeServer(workspace);
      return workspace;
    })().finally(() => {
      startPromisesByUser.delete(userId);
    });
    startPromisesByUser.set(userId, promise);
  }
  return promise;
}

async function proxyVsCodeHttp(req, res, viewer) {
  if (isExactVsCodeBasePath(req.url)) {
    res.statusCode = 308;
    res.setHeader("location", `${VSCODE_BASE_PATH}/`);
    res.end("Redirecting to VS Code");
    return;
  }

  if (!viewer) {
    sendUnauthorized(res);
    return;
  }

  let workspace;
  try {
    workspace = await ensureCodeServerForUser(viewer.id);
  } catch (error) {
    console.error("[vscode/proxy] startup failed", error);
    sendPlain(
      res,
      503,
      error instanceof Error ? error.message : "Unable to start VS Code."
    );
    return;
  }

  const upstreamPath = normalizeProxyPath(req.url);
  const upstreamHost = await getContainerHost(workspace.containerName);
  const headers = { ...req.headers };
  headers.host = `${workspace.containerName}:${VSCODE_PORT}`;
  headers["x-forwarded-host"] = req.headers.host || "";
  headers["x-forwarded-proto"] = req.socket.encrypted ? "https" : "http";
  headers["x-forwarded-prefix"] = VSCODE_BASE_PATH;

  const upstream = http.request(
    {
      hostname: upstreamHost,
      port: VSCODE_PORT,
      method: req.method,
      path: upstreamPath,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstream.on("error", (error) => {
    console.error("[vscode/proxy] request failed", error);
    if (!res.headersSent) {
      sendPlain(res, 502, "VS Code proxy request failed.");
    } else {
      res.destroy(error);
    }
  });

  req.pipe(upstream);
}

async function proxyVsCodeUpgrade(req, socket, head, viewer) {
  if (!viewer) {
    sendUpgradeError(socket, 401, "Authentication required");
    return;
  }

  let workspace;
  try {
    workspace = await ensureCodeServerForUser(viewer.id);
  } catch (error) {
    console.error("[vscode/proxy] websocket startup failed", error);
    sendUpgradeError(socket, 503, "Unable to start VS Code");
    return;
  }

  const upstreamPath = normalizeProxyPath(req.url);
  const upstreamHost = await getContainerHost(workspace.containerName);
  const headers = { ...req.headers };
  headers.host = `${workspace.containerName}:${VSCODE_PORT}`;
  headers["x-forwarded-host"] = req.headers.host || "";
  headers["x-forwarded-proto"] = "http";
  headers["x-forwarded-prefix"] = VSCODE_BASE_PATH;

  const upstream = http.request({
    hostname: upstreamHost,
    port: VSCODE_PORT,
    method: req.method,
    path: upstreamPath,
    headers,
  });

  upstream.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    socket.write(
      `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n` +
        Object.entries(upstreamRes.headers)
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
          .join("\r\n") +
        "\r\n\r\n"
    );
    if (upstreamHead.length) {
      socket.write(upstreamHead);
    }
    if (head.length) {
      upstreamSocket.write(head);
    }
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });

  upstream.on("error", (error) => {
    console.error("[vscode/proxy] websocket failed", error);
    sendUpgradeError(socket, 502, "VS Code websocket proxy failed");
  });

  upstream.end();
}

module.exports = {
  isVsCodePath,
  proxyVsCodeHttp,
  proxyVsCodeUpgrade,
};
