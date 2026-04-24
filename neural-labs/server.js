const { createServer } = require("node:http");

const next = require("next");
const { WebSocketServer } = require("next/dist/compiled/ws");
const { getTerminalManager: getRuntimeTerminalManager } = require("./lib/server/terminal-manager-runtime.js");

const TERMINAL_WS_PATH = "/api/neural-labs/terminal/ws";

let terminalManagerPromise = null;

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function sendJson(ws, payload) {
  if (ws.readyState !== ws.OPEN) {
    return;
  }

  ws.send(JSON.stringify(payload));
}

function parseTerminalWsRequest(url) {
  try {
    const parsed = new URL(url || "/", "http://localhost");
    if (parsed.pathname !== TERMINAL_WS_PATH) {
      return null;
    }

    const terminalToken = (parsed.searchParams.get("terminal_token") || "").trim();
    const authToken = (parsed.searchParams.get("token") || "").trim();
    if (!terminalToken || !authToken) {
      return null;
    }

    return { terminalToken, authToken };
  } catch {
    return null;
  }
}

async function getTerminalManager() {
  if (!terminalManagerPromise) {
    terminalManagerPromise = Promise.resolve(getRuntimeTerminalManager());
  }
  return terminalManagerPromise;
}

async function main() {
  const dev = process.argv.includes("--dev") || process.env.NODE_ENV !== "production";
  const hostname = readArg("--hostname") || process.env.HOST || "0.0.0.0";
  const port = Number.parseInt(readArg("--port") || process.env.PORT || "3000", 10);

  let handleRequest = null;
  let handleUpgrade = null;

  const server = createServer((req, res) => {
    if (!handleRequest) {
      res.statusCode = 503;
      res.end("Server not ready");
      return;
    }

    Promise.resolve(handleRequest(req, res)).catch((error) => {
      console.error("Request handler error", error);
      if (!res.headersSent) {
        res.statusCode = 500;
      }
      res.end("Internal Server Error");
    });
  });

  const app = next({
    dev,
    hostname,
    port,
    httpServer: server,
  });

  await app.prepare();
  handleRequest = app.getRequestHandler();
  handleUpgrade = app.getUpgradeHandler();
  await getTerminalManager();

  const terminalWss = new WebSocketServer({ noServer: true });

  terminalWss.on("connection", (ws, req) => {
    const wsRequest = parseTerminalWsRequest(req.url);
    if (!wsRequest) {
      sendJson(ws, { type: "error", text: "Invalid terminal websocket path." });
      ws.close();
      return;
    }

    let closed = false;
    let manager = null;
    let userId = null;
    let terminalId = null;
    let unsubscribe = () => {};

    const cleanup = () => {
      if (closed) {
        return;
      }
      closed = true;
      unsubscribe();
      unsubscribe = () => {};
    };

    const closeWithError = (text) => {
      console.warn("[terminal/ws] closeWithError:", text);
      sendJson(ws, { type: "error", text });
      cleanup();
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        ws.close();
      }
    };

    ws.on("message", (rawMessage) => {
      if (!manager || !terminalId) {
        return;
      }

      let payload = null;
      try {
        payload = JSON.parse(rawMessage.toString());
      } catch {
        sendJson(ws, { type: "error", text: "Malformed terminal message." });
        return;
      }

      if (payload?.type === "input" && typeof payload.data === "string") {
        try {
          manager.writeInput(userId, terminalId, payload.data);
        } catch (error) {
          closeWithError(
            error instanceof Error ? error.message : "Unable to write to terminal."
          );
        }
        return;
      }

      if (
        payload?.type === "resize" &&
        Number.isFinite(payload.cols) &&
        Number.isFinite(payload.rows)
      ) {
        // Resize messages are accepted for protocol compatibility. Current
        // shell sessions run without a PTY resize API in this runtime.
        return;
      }
    });

    ws.on("close", cleanup);
    ws.on("error", cleanup);

    void (async () => {
      manager = await getTerminalManager();
      userId = manager.consumeWsAuthTicket(wsRequest.authToken);
      if (!userId) {
        closeWithError("Invalid websocket authentication token.");
        return;
      }

      terminalId = manager.consumeWsTicket(userId, wsRequest.terminalToken);
      if (!terminalId) {
        closeWithError("Invalid terminal stream token.");
        return;
      }

      const session = manager.get(userId, terminalId);
      if (!session) {
        closeWithError("Terminal session not found.");
        return;
      }

      unsubscribe = manager.subscribe(userId, terminalId, (chunk) => {
        sendJson(ws, chunk);
      });

    })().catch((error) => {
      console.error("Terminal websocket setup failed", error);
      closeWithError(
        error instanceof Error ? error.message : "Terminal stream disconnected."
      );
    });
  });

  server.on("upgrade", (req, socket, head) => {
    if (parseTerminalWsRequest(req.url)) {
      terminalWss.handleUpgrade(req, socket, head, (ws) => {
        terminalWss.emit("connection", ws, req);
      });
      return;
    }

    if (handleUpgrade) {
      handleUpgrade(req, socket, head);
      return;
    }

    socket.destroy();
  });

  server.listen(port, hostname, () => {
    console.log(
      `> Ready on http://${hostname}:${port} (${dev ? "development" : "production"})`
    );
  });
}

main().catch((error) => {
  console.error("Server startup error", error);
  process.exit(1);
});
