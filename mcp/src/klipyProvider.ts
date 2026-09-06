import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ProviderConfig } from "./providerConfig.js";

import { requestKlipy, extractResults } from "./klipyClient.js";

function normalizeLimit(value: number): number { return Math.min(20, Math.max(8, value)); }

export function registerKlipyTools(
  server: McpServer,
  config: ProviderConfig,
  fetchFn: typeof globalThis.fetch,
): void {
  if (!config.klipyApiKey) return;
  const apiKey = config.klipyApiKey;
  server.registerTool(
    "search_gif",
    {
      title: "Search reaction GIFs",
      description:
        "Search KLIPY for 8-20 GIF choices. Review the entire result set and choose at most one for the intended mood.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(160),
        limit: z.number().int().default(12),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ query, limit }) => {
      const normalizedQuery = query.replace(/\s+/g, " ").trim();
      const normalizedLimit = normalizeLimit(limit);
      const payload = await requestKlipy(
        apiKey,
        normalizedQuery,
        fetchFn,
      );
      const results = extractResults(payload, normalizedLimit);
      const output = {
        query: normalizedQuery,
        count: results.length,
        results,
        selectionGuidance:
          "Review all candidates and choose at most one for the exact mood. Do not default to the first result; vary equally suitable choices and avoid recently used GIFs.",
        poweredBy: "KLIPY",
        timestamp: new Date().toISOString(),
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );
}
