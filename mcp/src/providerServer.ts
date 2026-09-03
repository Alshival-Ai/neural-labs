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

const GOOGLE_TOOLS = [
  "google_places_search",
  "google_place_details",
  "google_place_photo",
  "google_geocode_address",
  "google_reverse_geocode",
];
const KLIPY_TOOLS = ["search_gif"];
const PEXELS_TOOLS = [
  "pexels_search_photos",
  "pexels_search_videos",
  "pexels_download_media",
];

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
    const googleConfigured = Boolean(config.googleApiKey);
    const klipyConfigured = Boolean(config.klipyApiKey);
    const pexelsConfigured = Boolean(config.pexelsApiKey);
    response.status(200).json({
      status: "ok",
      mode: "workspace-local",
      transport: "streamable-http",
      agentServerName: "neural-labs-tools",
      publicAccess: false,
      googleConfigured,
      klipyConfigured,
      pexelsConfigured,
      providers: {
        googlePlaces: googleConfigured,
        googleGeocoding: googleConfigured,
        klipy: klipyConfigured,
        pexels: pexelsConfigured,
      },
      tools: [
        ...(googleConfigured ? GOOGLE_TOOLS : []),
        ...(klipyConfigured ? KLIPY_TOOLS : []),
        ...(pexelsConfigured ? PEXELS_TOOLS : []),
      ],
    });
  });

  const handler = createMcpHandler(
    () => {
      const server = new McpServer(
        { name: "neural-labs-workspace-tools", version: "0.3.0" },
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
