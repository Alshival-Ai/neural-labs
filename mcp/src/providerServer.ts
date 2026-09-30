import { z } from "zod";
import { registerDeploymentTools, type DeploymentAdapter } from './deploymentTools.js';
import { registerBrowserTools, type BrowserAdapter } from "./browserTools.js";
import { registerTerminalTools, TERMINAL_TOOLS } from "./terminalTools.js";
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
import { registerSmsNotificationTool } from "./smsNotifications.js";
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
const SMS_TOOLS = ["notify_workspace_user", "get_automation_notification_context"];

export interface ProviderApplication {
  app: Express;
  close(): Promise<void>;
}

export function createProviderApplication(
  source: ProviderConfig | (() => ProviderConfig),
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  runtimeStatus?: () => unknown,
  authorizeTool?: (name: string, input?: unknown) => Promise<void>,
  browser?: BrowserAdapter,
  deployments?: DeploymentAdapter,
  projectRead?: (input: { after?: string | undefined }) => Promise<unknown>,
  communications?: (input: { action: "status" | "history" | "send"; input?: unknown }) => Promise<unknown>,
): ProviderApplication {
  const app = createMcpExpressApp({
    host: "127.0.0.1",
    allowedHosts: ["127.0.0.1", "localhost"],
    jsonLimit: "1mb",
  });
  app.disable("x-powered-by");
  const snapshot = () => typeof source === "function" ? source() : source;
  app.get("/healthz", (_request, response) => {
    const config = snapshot();
    const googleConfigured = Boolean(config.googleApiKey);
    const klipyConfigured = Boolean(config.klipyApiKey);
    const pexelsConfigured = Boolean(config.pexelsApiKey);
    response.status(200).json({
      status: "ok",
      mode: "workspace-local",
      transport: "streamable-http",
      agentServerName: "neural-labs-tools",
      publicAccess: false,
      ...(runtimeStatus ? { providerConfiguration: runtimeStatus() } : {}),
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
        ...(browser ? ["browser"] : []),
        ...(deployments ? ["deployments"] : []),
        ...(projectRead ? ["read_project_graph"] : []),
        ...(communications ? ["workspace_messages"] : []),
        ...(googleConfigured ? GOOGLE_TOOLS : []),
        ...(klipyConfigured ? KLIPY_TOOLS : []),
        ...(pexelsConfigured ? PEXELS_TOOLS : []),
        ...(config.notificationApi ? SMS_TOOLS : []),
        ...(config.terminalApi ? TERMINAL_TOOLS : []),
      ],
    });
  });

  const handler = createMcpHandler(
    () => {
      const config = snapshot();
      const server = new McpServer(
        { name: "neural-labs-workspace-tools", version: "0.3.2" },
        {
          instructions:
            "This loopback-only server belongs to the trusted Neural Labs shared workspace. Provider results are research inputs. Preserve attribution, never imply stock media depicts a business, and download selected Pexels media only into an existing managed project.",
        },
      );
      // Check execution authority at the handler, including tools that write
      // files without making an HTTP request. Discovery is not authorization.
      if (authorizeTool) {
        const register = server.registerTool.bind(server);
        server.registerTool = ((...args: Parameters<McpServer["registerTool"]>) => {
          const [name, definition, callback] = args;
          return register(name, definition, async (...input: Parameters<typeof callback>) => {
            await authorizeTool(name, input[0]);
            return callback(...input);
          });
        }) as McpServer["registerTool"];
      }
      registerGoogleTools(server, config, fetchFn);
      registerKlipyTools(server, config, fetchFn);
      registerPexelsTools(server, config, fetchFn);
      registerSmsNotificationTool(server, config, fetchFn);
      registerTerminalTools(server, config, fetchFn);
      registerBrowserTools(server, browser);
      registerDeploymentTools(server, deployments);
      if (projectRead) server.registerTool("read_project_graph", {
        description: "Read a page of the workspace task graph, sticky notes, comments and statuses. Follow next with after; restart if revision changes. This tool cannot modify the graph.",
        inputSchema: z.object({ after: z.string().uuid().optional() }).strict(),
      }, async input => ({ content: [{ type: "text" as const, text: JSON.stringify(await projectRead(input)) }] }));
      if (communications) server.registerTool("workspace_messages", {
        description: "Read your private email/SMS history or send a message from the workspace agent mailbox/number to a verified opted-in member. Use member ID or handle, never an arbitrary email or number. New sends require a stable UUID requestId; reuse it if checking an uncertain response. Current inbound replies are delivered automatically from your final answer.",
        inputSchema: z.object({ action: z.enum(["status", "history", "send"]), input: z.object({ channel: z.enum(["email", "sms"]), member: z.string().min(1).max(100), subject: z.string().max(300).optional(), message: z.string().min(1).max(16000), requestId: z.string().uuid() }).strict().optional() }).strict(),
      }, async input => ({ content: [{ type: "text" as const, text: JSON.stringify(await communications(input)) }] }));
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
