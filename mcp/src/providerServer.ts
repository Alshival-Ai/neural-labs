import {
  createMcpHandler,
  McpServer,
} from "@modelcontextprotocol/server";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { Express, NextFunction, Request, Response } from "express";

import { registerGoogleTools } from "./googleProviders.js";
import { registerKlipyTools } from "./klipyProvider.js";
import { registerPexelsTools } from "./pexelsProvider.js";
import type { ProviderConfig } from "./providerConfig.js";

export interface ProviderApplication {
  app: Express;
  close(): Promise<void>;
}

export function createProviderApplication(
  config: ProviderConfig,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): ProviderApplication {
  const app = createMcpExpressApp({
    host: "127.0.0.1",
    allowedHosts: ["127.0.0.1", "localhost"],
    jsonLimit: "1mb",
  });
  app.disable("x-powered-by");
  app.get("/healthz", (_request, response) => {
    response.status(200).json({
      status: "ok",
      googleConfigured: Boolean(config.googleApiKey),
      klipyConfigured: Boolean(config.klipyApiKey),
      pexelsConfigured: Boolean(config.pexelsApiKey),
    });
  });

  const handler = createMcpHandler(
    () => {
      const server = new McpServer(
        { name: "neural-labs-workspace-tools", version: "0.1.0" },
        {
          instructions:
            "This loopback-only server belongs to the trusted Neural Labs shared workspace. Provider results are research inputs. Preserve attribution, never imply stock media depicts a business, and download selected Pexels media only into an existing managed project.",
        },
      );
      registerGoogleTools(server, config, fetchFn);
      registerKlipyTools(server, config, fetchFn);
      registerPexelsTools(server, config, fetchFn);
      return server;
    },
    {
      legacy: "stateless",
      onerror: (error) => console.error("Workspace MCP request failed", error),
    },
  );
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => console.error("Workspace MCP adapter failed", error),
  });
  app.all(
    "/mcp",
    (request: Request, response: Response, next: NextFunction) => {
      void nodeHandler(request, response, request.body).catch(next);
    },
  );
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      console.error("Unhandled workspace MCP error", error);
      if (!response.headersSent) {
        response.status(500).json({ error: "internal_server_error" });
      }
    },
  );
  return { app, close: () => handler.close() };
}
