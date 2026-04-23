const { createServer } = require("node:http");
const { parse } = require("node:url");

const next = require("next");
const { WebSocketServer } = require("next/dist/compiled/ws");

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function getTerminalSocketSessionId(url) {
  const { pathname } = parse(url || "/", true);
  if (!pathname) {
    return null;
  }

  const match = pathname.match(
    /^\/api\/neural-labs\/terminal\/sessions\/([^/]+)\/socket$/
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function createInternalUrl(port, pathname) {
  return `http://127.0.0.1:${port}${pathname}`;
}

function sendJson(ws, payload) {
  if (ws.readyState !== ws.OPEN) {
    return;
  }

  ws.send(JSON.stringify(payload));
}

async function postTerminalAction(port, sessionId, pathname, payload) {
  const response = await fetch(
    createInternalUrl(port, `/api/neural-labs/terminal/sessions/${sessionId}/${pathname}`),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Terminal ${pathname} request failed`);
  }
}

async function pipeTerminalStream(port, sessionId, ws, abortSignal) {
  const response = await fetch(
    createInternalUrl(
      port,
      `/api/neural-labs/terminal/sessions/${sessionId}/stream`
    ),
    {
      headers: {
        Accept: "text/event-stream",
      },
      signal: abortSignal,
    }
  );

  if (!response.ok || !response.body) {
    const message = await response.text();
    throw new Error(message || "Unable to connect terminal stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const forwardEvent = (rawEvent) => {
    const lines = rawEvent
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);

    const dataLines = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) {
      return;
    }

    if (ws.readyState === ws.OPEN) {
      ws.send(dataLines.join("\n"));
    }
  };

  while (!abortSignal.aborted) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let delimiterIndex = buffer.indexOf("\n\n");
    while (delimiterIndex !== -1) {
      const rawEvent = buffer.slice(0, delimiterIndex);
      buffer = buffer.slice(delimiterIndex + 2);
      forwardEvent(rawEvent);
      delimiterIndex = buffer.indexOf("\n\n");
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    forwardEvent(buffer);
  }
}

async function main() {
  const dev = process.argv.includes("--dev") || process.env.NODE_ENV !== "production";
  const hostname = readArg("--hostname") || process.env.HOSTNAME || "0.0.0.0";
  const port = Number.parseInt(readArg("--port") || process.env.PORT || "3000", 10);

  let handleRequest = null;
  let handleUpgrade = null;

  const server = createServer((req, res) => {
    if (!handleRequest) {
      res.statusCode = 503;
      res.end("Server not ready");
      return;
    }

    const parsedUrl = parse(req.url || "/", true);
    Promise.resolve(handleRequest(req, res, parsedUrl)).catch((error) => {
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

  const terminalWss = new WebSocketServer({ noServer: true });

  terminalWss.on("connection", (ws, req) => {
    const sessionId = getTerminalSocketSessionId(req.url);
    if (!sessionId) {
      sendJson(ws, { type: "error", text: "Invalid terminal session." });
      ws.close();
      return;
    }

    const controller = new AbortController();
    let closed = false;

    const closeSocket = () => {
      if (closed) {
        return;
      }
      closed = true;
      controller.abort();
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        ws.close();
      }
    };

    ws.on("message", (rawMessage) => {
      let payload;

      try {
        payload = JSON.parse(rawMessage.toString());
      } catch {
        sendJson(ws, { type: "error", text: "Malformed terminal message." });
        return;
      }

      if (payload?.type === "input" && typeof payload.data === "string") {
        void postTerminalAction(port, sessionId, "input", { data: payload.data }).catch(
          (error) => {
            sendJson(ws, {
              type: "error",
              text: error instanceof Error ? error.message : "Unable to write to terminal.",
            });
          }
        );
        return;
      }

      if (
        payload?.type === "resize" &&
        Number.isFinite(payload.cols) &&
        Number.isFinite(payload.rows)
      ) {
        void postTerminalAction(port, sessionId, "resize", {
          cols: payload.cols,
          rows: payload.rows,
        }).catch((error) => {
          sendJson(ws, {
            type: "error",
            text: error instanceof Error ? error.message : "Unable to resize terminal.",
          });
        });
      }
    });

    ws.on("close", closeSocket);
    ws.on("error", closeSocket);

    void pipeTerminalStream(port, sessionId, ws, controller.signal).catch((error) => {
      if (controller.signal.aborted) {
        return;
      }

      sendJson(ws, {
        type: "error",
        text: error instanceof Error ? error.message : "Terminal stream disconnected.",
      });
      closeSocket();
    });
  });

  server.on("upgrade", (req, socket, head) => {
    if (getTerminalSocketSessionId(req.url)) {
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
