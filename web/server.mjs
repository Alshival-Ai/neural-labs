import { createReadStream, realpathSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function sendText(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "text/plain; charset=utf-8",
    ...headers,
  });
  response.end(body);
}

function parseRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? "");
  if (!match || (!match[1] && !match[2]) || size === 0) {
    return null;
  }

  let start;
  let end;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return null;
  }

  return { start, end: Math.min(end, size - 1) };
}

export function createStaticServer({ root = moduleDirectory, logger = console } = {}) {
  const canonicalRoot = realpathSync(root);
  const rootPrefix = `${canonicalRoot}${path.sep}`;

  return http.createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");

    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");

      if (requestUrl.pathname === "/healthz") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          sendText(response, 405, "Method not allowed\n", { Allow: "GET, HEAD" });
          return;
        }
        const body = "ok\n";
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Length": Buffer.byteLength(body),
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end(request.method === "HEAD" ? undefined : body);
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        sendText(response, 405, "Method not allowed\n", { Allow: "GET, HEAD" });
        return;
      }

      let pathname;
      try {
        pathname = decodeURIComponent(requestUrl.pathname);
      } catch {
        sendText(response, 400, "Bad request\n");
        return;
      }

      if (pathname.includes("\0")) {
        sendText(response, 400, "Bad request\n");
        return;
      }

      const loginFallback = pathname === "/login";
      const requestedPath = loginFallback
        ? "/login-pending.html"
        : pathname === "/favicon.ico"
          ? "/assets/brand/neural-labs-favicon.svg"
        : pathname.endsWith("/")
          ? `${pathname}index.html`
          : pathname;
      const isPublicPath =
        requestedPath === "/index.html" ||
        requestedPath === "/login-pending.html" ||
        requestedPath === "/styles.css" ||
        requestedPath === "/app.js" ||
        requestedPath.startsWith("/assets/");

      if (!isPublicPath) {
        sendText(response, 404, "Not found\n");
        return;
      }

      const candidatePath = path.resolve(canonicalRoot, `.${requestedPath}`);

      if (candidatePath !== canonicalRoot && !candidatePath.startsWith(rootPrefix)) {
        sendText(response, 404, "Not found\n");
        return;
      }

      let canonicalPath;
      let fileStats;
      try {
        canonicalPath = await realpath(candidatePath);
        if (canonicalPath !== canonicalRoot && !canonicalPath.startsWith(rootPrefix)) {
          sendText(response, 404, "Not found\n");
          return;
        }
        fileStats = await stat(canonicalPath);
      } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
          sendText(response, 404, "Not found\n");
          return;
        }
        throw error;
      }

      if (!fileStats.isFile()) {
        sendText(response, 404, "Not found\n");
        return;
      }

      const extension = path.extname(canonicalPath).toLowerCase();
      const requiresRevalidation = extension === ".html" || extension === ".css" || extension === ".js";
      const headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": requiresRevalidation ? "no-cache" : "public, max-age=3600",
        "Content-Type": contentTypes.get(extension) ?? "application/octet-stream",
      };

      let statusCode = loginFallback ? 503 : 200;
      let start = 0;
      let end = fileStats.size - 1;

      if (request.headers.range) {
        const range = parseRange(request.headers.range, fileStats.size);
        if (!range) {
          response.writeHead(416, {
            ...headers,
            "Content-Range": `bytes */${fileStats.size}`,
            "Content-Length": 0,
          });
          response.end();
          return;
        }
        ({ start, end } = range);
        statusCode = 206;
        headers["Content-Range"] = `bytes ${start}-${end}/${fileStats.size}`;
      }

      headers["Content-Length"] = Math.max(end - start + 1, 0);
      response.writeHead(statusCode, headers);

      if (request.method === "HEAD" || fileStats.size === 0) {
        response.end();
        return;
      }

      const stream = createReadStream(canonicalPath, { start, end });
      stream.on("error", (error) => {
        logger.error("Static file stream failed", error);
        response.destroy(error);
      });
      stream.pipe(response);
    } catch (error) {
      logger.error("Static request failed", error);
      if (!response.headersSent) {
        sendText(response, 500, "Internal server error\n");
      } else {
        response.destroy(error);
      }
    }
  });
}

function start() {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? "4173");

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const server = createStaticServer();
  server.listen(port, host, () => {
    console.log(`Neural Labs web listening on http://${host}:${port}`);
  });

  const shutdown = (signal) => {
    console.log(`Received ${signal}; closing Neural Labs web`);
    server.close((error) => {
      process.exitCode = error ? 1 : 0;
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}
