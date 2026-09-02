import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ProviderConfig } from "./providerConfig.js";

const KLIPY_API_URL = "https://api.klipy.com/v2/search";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function cleanText(value: unknown): string | undefined {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function safeHttps(value: unknown): string | undefined {
  const raw = cleanText(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeLimit(value: number): number {
  return Math.min(20, Math.max(8, value));
}

async function requestKlipy(
  apiKey: string,
  query: string,
  fetchFn: typeof globalThis.fetch,
): Promise<JsonObject> {
  const url = new URL(KLIPY_API_URL);
  url.search = new URLSearchParams({
    q: query,
    media_filter: "gif",
    key: apiKey,
    client_key: "neural-labs-workspace",
    limit: "20",
  }).toString();
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("KLIPY GIF search could not reach the provider");
  }
  if (!response.ok) {
    throw new Error("KLIPY GIF search failed with HTTP " + response.status);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("KLIPY GIF search exceeded the response size limit");
  }
  const raw = new Uint8Array(await response.arrayBuffer());
  if (raw.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("KLIPY GIF search exceeded the response size limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error("KLIPY GIF search returned invalid JSON");
  }
  const payload = record(parsed);
  if (!payload) throw new Error("KLIPY GIF search returned an unexpected response");
  return payload;
}

function extractResults(payload: JsonObject, limit: number): JsonObject[] {
  if (!Array.isArray(payload.results)) return [];
  const results: JsonObject[] = [];
  for (const raw of payload.results) {
    const item = record(raw);
    const formats = record(item?.media_formats);
    if (!item || !formats) continue;
    let url: string | undefined;
    for (const name of ["gif", "mediumgif", "tinygif"]) {
      url = safeHttps(record(formats[name])?.url);
      if (url) break;
    }
    if (!url) continue;
    results.push({
      id: cleanText(item.id) ?? null,
      title:
        cleanText(item.content_description) ?? cleanText(item.title) ?? null,
      url,
    });
    if (results.length >= limit) break;
  }
  return results;
}

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
