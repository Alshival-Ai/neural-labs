import { createServer, type RequestListener } from "node:http";

import { loadConfig } from "./config.js";
import {
  fetchRuntimeConfig,
  loadRuntimeConfigSource,
  type RuntimeConfigSource,
} from "./runtimeConfig.js";
import { createApplication, type McpApplication } from "./server.js";

function binding(env: NodeJS.ProcessEnv): { host: string; port: number } {
  const host = env.MCP_HOST?.trim() || "127.0.0.1";
  const port = Number(env.MCP_PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("MCP_PORT must be an integer between 1 and 65535");
  }
  return { host, port };
}

const unavailable: RequestListener = (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  if (pathname === "/healthz") {
    response.statusCode = 200;
    response.end(JSON.stringify({ status: "unconfigured" }));
    return;
  }
  response.statusCode = 503;
  response.end(JSON.stringify({ error: "mcp_unconfigured" }));
};

async function startStatic(): Promise<void> {
  const config = loadConfig();
  const application = createApplication(config);
  const httpServer = createServer(application.app);
  httpServer.listen(config.port, config.host, () => {
    console.log(`Neural Labs MCP listening on ${config.host}:${config.port}`);
    console.log(`Public MCP URL: ${config.publicUrl.toString()}`);
  });
  installShutdown(httpServer, () => application.close());
}

async function startManaged(source: RuntimeConfigSource): Promise<void> {
  const { host, port } = binding(process.env);
  let handler: RequestListener = unavailable;
  let active: McpApplication | undefined;
  let activeVersion: number | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopping = false;

  const httpServer = createServer((request, response) => handler(request, response));
  httpServer.listen(port, host, () => {
    console.log(`Neural Labs managed MCP listening on ${host}:${port}`);
  });

  const refresh = async (): Promise<void> => {
    try {
      const result = await fetchRuntimeConfig(source);
      if (result.state === "configured" && result.version !== activeVersion) {
        const next = createApplication(result.config);
        const previous = active;
        active = next;
        activeVersion = result.version;
        handler = next.app;
        await previous?.close();
        console.log(`Loaded MCP configuration version ${result.version}`);
      } else if (result.state === "unconfigured" && active) {
        const previous = active;
        active = undefined;
        activeVersion = result.version;
        handler = unavailable;
        await previous.close();
        console.log("MCP was disabled by the control plane");
      }
    } catch (error) {
      console.error("Could not refresh MCP configuration; retaining current state", error);
    } finally {
      if (!stopping) timer = setTimeout(() => void refresh(), source.pollIntervalMs);
    }
  };
  void refresh();

  installShutdown(httpServer, async () => {
    stopping = true;
    if (timer) clearTimeout(timer);
    await active?.close();
  });
}

function installShutdown(
  httpServer: ReturnType<typeof createServer>,
  beforeClose: () => Promise<void>,
): void {
  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`Received ${signal}; shutting down`);
    await beforeClose();
    httpServer.close((error) => {
      if (error) {
        console.error("HTTP shutdown failed", error);
        process.exitCode = 1;
      }
    });
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void stop(signal));
  }
}

const source = await loadRuntimeConfigSource();
if (source) await startManaged(source);
else await startStatic();
