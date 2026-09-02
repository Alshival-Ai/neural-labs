import { createHash } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ProviderConfig } from "./providerConfig.js";

const PLACES_ROOT = "https://places.googleapis.com/v1";
const GEOCODING_ROOT = "https://maps.googleapis.com/maps/api/geocode/json";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PLACE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const PHOTO_NAME = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;
const SEARCH_MASK = [
  "nextPageToken",
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.businessStatus",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
  "places.photos",
].join(",");
const DETAIL_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "primaryType",
  "primaryTypeDisplayName",
  "businessStatus",
  "websiteUri",
  "googleMapsUri",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "rating",
  "userRatingCount",
  "regularOpeningHours",
  "photos",
].join(",");

type JsonObject = Record<string, unknown>;

function timestamp(): string {
  return new Date().toISOString();
}

function record(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function cleanText(value: unknown): string | undefined {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function localizedText(value: unknown): string | undefined {
  return cleanText(record(value)?.text);
}

function safeHttps(value: unknown): string | undefined {
  const raw = cleanText(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
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

async function parseJsonResponse(
  response: Response,
  provider: string,
): Promise<JsonObject> {
  if (!response.ok) {
    throw new Error(provider + " request failed with HTTP " + response.status);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_RESPONSE_BYTES
  ) {
    throw new Error(provider + " response exceeded the size limit");
  }
  const raw = new Uint8Array(await response.arrayBuffer());
  if (raw.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error(provider + " response exceeded the size limit");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error(provider + " returned invalid JSON");
  }
  const parsed = record(value);
  if (!parsed) throw new Error(provider + " returned an unexpected response");
  return parsed;
}

async function placesRequest(
  apiKey: string,
  url: URL,
  fetchFn: typeof globalThis.fetch,
  options: { method?: string; body?: JsonObject; fieldMask?: string } = {},
): Promise<JsonObject> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Goog-Api-Key": apiKey,
  };
  if (options.fieldMask) headers["X-Goog-FieldMask"] = options.fieldMask;
  if (options.body) headers["Content-Type"] = "application/json";
  try {
    const response = await fetchFn(url, {
      method: options.method ?? "GET",
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await parseJsonResponse(response, "Google Places");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Google Places")) {
      throw error;
    }
    throw new Error("Google Places request could not reach the provider");
  }
}

async function geocodingRequest(
  apiKey: string,
  params: URLSearchParams,
  fetchFn: typeof globalThis.fetch,
): Promise<JsonObject> {
  params.set("key", apiKey);
  const url = new URL(GEOCODING_ROOT);
  url.search = params.toString();
  try {
    const response = await fetchFn(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await parseJsonResponse(response, "Google Geocoding");
    const status = cleanText(payload.status);
    if (status !== "OK" && status !== "ZERO_RESULTS") {
      throw new Error(
        "Google Geocoding request failed with status " + (status ?? "UNKNOWN"),
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Google Geocoding")) {
      throw error;
    }
    throw new Error("Google Geocoding request could not reach the provider");
  }
}

function photoMetadata(value: unknown, limit: number): JsonObject[] {
  if (!Array.isArray(value)) return [];
  const output: JsonObject[] = [];
  for (const raw of value.slice(0, limit)) {
    const item = record(raw);
    const name = cleanText(item?.name);
    if (!item || !name || !PHOTO_NAME.test(name)) continue;
    const attributions = Array.isArray(item.authorAttributions)
      ? item.authorAttributions
          .map((entry) => {
            const source = record(entry);
            if (!source) return undefined;
            return {
              displayName: cleanText(source.displayName) ?? "",
              uri: safeHttps(source.uri) ?? "",
              photoUri: safeHttps(source.photoUri) ?? "",
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      : [];
    output.push({
      name,
      authorAttributions: attributions,
      ...(Number.isInteger(item.widthPx) ? { widthPx: item.widthPx } : {}),
      ...(Number.isInteger(item.heightPx) ? { heightPx: item.heightPx } : {}),
      ...(safeHttps(item.googleMapsUri)
        ? { googleMapsUri: safeHttps(item.googleMapsUri) }
        : {}),
    });
  }
  return output;
}

function normalizePlace(value: unknown, photoLimit = 5): JsonObject | undefined {
  const item = record(value);
  const id = cleanText(item?.id);
  if (!item || !id) return undefined;
  const location = record(item.location);
  const hours = record(item.regularOpeningHours);
  return {
    id,
    displayName: localizedText(item.displayName) ?? null,
    formattedAddress: cleanText(item.formattedAddress) ?? null,
    primaryType: cleanText(item.primaryType) ?? null,
    primaryTypeDisplayName: localizedText(item.primaryTypeDisplayName) ?? null,
    businessStatus: cleanText(item.businessStatus) ?? null,
    websiteUri: safeHttps(item.websiteUri) ?? null,
    googleMapsUri: safeHttps(item.googleMapsUri) ?? null,
    photos: photoMetadata(item.photos, photoLimit),
    ...(location &&
    typeof location.latitude === "number" &&
    typeof location.longitude === "number"
      ? {
          location: {
            latitude: location.latitude,
            longitude: location.longitude,
          },
        }
      : {}),
    ...(cleanText(item.nationalPhoneNumber)
      ? { nationalPhoneNumber: cleanText(item.nationalPhoneNumber) }
      : {}),
    ...(cleanText(item.internationalPhoneNumber)
      ? { internationalPhoneNumber: cleanText(item.internationalPhoneNumber) }
      : {}),
    ...(typeof item.rating === "number" ? { rating: item.rating } : {}),
    ...(Number.isInteger(item.userRatingCount)
      ? { userRatingCount: item.userRatingCount }
      : {}),
    ...(Array.isArray(hours?.weekdayDescriptions)
      ? {
          regularOpeningHours: hours.weekdayDescriptions
            .map(cleanText)
            .filter((entry): entry is string => Boolean(entry))
            .slice(0, 7),
        }
      : {}),
  };
}

function normalizeGeocode(value: unknown): JsonObject | undefined {
  const item = record(value);
  const geometry = record(item?.geometry);
  const location = record(geometry?.location);
  if (
    !item ||
    !location ||
    typeof location.lat !== "number" ||
    typeof location.lng !== "number"
  ) {
    return undefined;
  }
  return {
    formattedAddress: cleanText(item.formatted_address) ?? null,
    placeId: cleanText(item.place_id) ?? null,
    location: { latitude: location.lat, longitude: location.lng },
    locationType: cleanText(geometry?.location_type) ?? null,
    types: Array.isArray(item.types)
      ? item.types
          .map(cleanText)
          .filter((entry): entry is string => Boolean(entry))
      : [],
    partialMatch: item.partial_match === true,
    plusCode: cleanText(record(item.plus_code)?.global_code) ?? null,
  };
}

function mcpValue(result: JsonObject) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

function seededKey(seed: string, placeId: string): Buffer {
  return createHash("sha256").update(seed).update("\0").update(placeId).digest();
}

export function registerGoogleTools(
  server: McpServer,
  config: ProviderConfig,
  fetchFn: typeof globalThis.fetch,
): void {
  if (!config.googleApiKey) return;
  const apiKey = config.googleApiKey;

  server.registerTool(
    "google_places_search",
    {
      title: "Search Google Places",
      description:
        "Search bounded live Google Places business data in a named city. Treat results as research leads and preserve photo attribution.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(160),
        city: z.string().trim().min(1).max(120),
        max_results: z.number().int().min(1).max(20).default(10),
        included_type: z
          .string()
          .regex(/^[a-z][a-z0-9_]{0,79}$/)
          .optional(),
        region_code: z.string().regex(/^[A-Za-z]{2}$/).default("US"),
        exclude_place_ids: z
          .array(z.string().regex(PLACE_ID))
          .max(500)
          .default([]),
        page_token: z.string().min(1).max(4096).optional(),
        result_seed: z.string().max(128).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const body: JsonObject = {
        textQuery:
          input.query.replace(/\s+/g, " ").trim() +
          " in " +
          input.city.replace(/\s+/g, " ").trim(),
        pageSize: input.max_results,
        regionCode: input.region_code.toUpperCase(),
        ...(input.included_type
          ? { includedType: input.included_type, strictTypeFiltering: true }
          : {}),
        ...(input.page_token ? { pageToken: input.page_token } : {}),
      };
      const payload = await placesRequest(
        apiKey,
        new URL(PLACES_ROOT + "/places:searchText"),
        fetchFn,
        { method: "POST", body, fieldMask: SEARCH_MASK },
      );
      const excluded = new Set(input.exclude_place_ids);
      const places = Array.isArray(payload.places) ? payload.places : [];
      let excludedCount = 0;
      const results: JsonObject[] = [];
      for (const [index, entry] of places.entries()) {
        const place = normalizePlace(entry, 1);
        if (!place) continue;
        if (excluded.has(String(place.id))) {
          excludedCount += 1;
          continue;
        }
        results.push({ ...place, providerRank: index + 1 });
        if (results.length >= input.max_results) break;
      }
      if (input.result_seed) {
        results.sort((a, b) =>
          Buffer.compare(
            seededKey(input.result_seed as string, String(a.id)),
            seededKey(input.result_seed as string, String(b.id)),
          ),
        );
      }
      return mcpValue({
        query: input.query,
        city: input.city,
        count: results.length,
        providerCount: places.length,
        excludedCount,
        results,
        nextPageToken: cleanText(payload.nextPageToken) ?? null,
        resultSeed: input.result_seed ?? null,
        usageGuidance:
          "Verify important facts independently. Photo names are temporary and must retain their author attribution and Google Maps source.",
        timestamp: timestamp(),
      });
    },
  );

  server.registerTool(
    "google_place_details",
    {
      title: "Get Google Place details",
      description: "Retrieve bounded details for one exact Google Place ID.",
      inputSchema: z.object({ place_id: z.string().regex(PLACE_ID) }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ place_id }) => {
      const payload = await placesRequest(
        apiKey,
        new URL(PLACES_ROOT + "/places/" + encodeURIComponent(place_id)),
        fetchFn,
        { fieldMask: DETAIL_MASK },
      );
      const place = normalizePlace(payload);
      if (!place) throw new Error("Google Places returned no usable place details");
      return mcpValue({
        place,
        usageGuidance:
          "Verify launch-critical facts against the business's current first-party sources.",
        timestamp: timestamp(),
      });
    },
  );

  server.registerTool(
    "google_place_photo",
    {
      title: "Resolve a Google Place photo",
      description:
        "Resolve one fresh Google Places photo resource to a temporary HTTPS URI. Preserve the corresponding attribution.",
      inputSchema: z.object({
        photo_name: z.string().regex(PHOTO_NAME),
        max_width_px: z.number().int().min(400).max(1600).default(1200),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ photo_name, max_width_px }) => {
      const url = new URL(PLACES_ROOT + "/" + photo_name + "/media");
      url.searchParams.set("maxWidthPx", String(max_width_px));
      url.searchParams.set("skipHttpRedirect", "true");
      url.searchParams.set("key", apiKey);
      let payload: JsonObject;
      try {
        payload = await parseJsonResponse(
          await fetchFn(url, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }),
          "Google Places",
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Google Places")
        ) {
          throw error;
        }
        throw new Error("Google Places request could not reach the provider");
      }
      const photoUri = safeHttps(payload.photoUri);
      if (!photoUri) throw new Error("Google Places returned no safe photo URI");
      return mcpValue({
        photoUri,
        photoName: photo_name,
        maxWidthPx: max_width_px,
        attributionRequired: true,
        usageGuidance:
          "Use attribution from the source Places result. The resource name and URI are temporary and must not be treated as a durable business-owned asset.",
        timestamp: timestamp(),
      });
    },
  );

  server.registerTool(
    "google_geocode_address",
    {
      title: "Geocode an address",
      description:
        "Resolve a bounded postal address to normalized Google Geocoding results and coordinates.",
      inputSchema: z.object({
        address: z.string().trim().min(1).max(500),
        region_code: z.string().regex(/^[A-Za-z]{2}$/).default("US"),
        language_code: z
          .string()
          .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z]{2})?$/)
          .default("en"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ address, region_code, language_code }) => {
      const params = new URLSearchParams({
        address,
        region: region_code.toLowerCase(),
        language: language_code,
      });
      const payload = await geocodingRequest(apiKey, params, fetchFn);
      const results = (Array.isArray(payload.results) ? payload.results : [])
        .map(normalizeGeocode)
        .filter((entry): entry is JsonObject => Boolean(entry))
        .slice(0, 10);
      return mcpValue({
        query: address,
        count: results.length,
        results,
        usageGuidance:
          "Use geocoding output for location support, not as sole proof of a business identity or current operating address.",
        timestamp: timestamp(),
      });
    },
  );

  server.registerTool(
    "google_reverse_geocode",
    {
      title: "Reverse geocode coordinates",
      description:
        "Resolve latitude and longitude to bounded Google Geocoding address results.",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        language_code: z
          .string()
          .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z]{2})?$/)
          .default("en"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ latitude, longitude, language_code }) => {
      const params = new URLSearchParams({
        latlng: String(latitude) + "," + String(longitude),
        language: language_code,
      });
      const payload = await geocodingRequest(apiKey, params, fetchFn);
      const results = (Array.isArray(payload.results) ? payload.results : [])
        .map(normalizeGeocode)
        .filter((entry): entry is JsonObject => Boolean(entry))
        .slice(0, 10);
      return mcpValue({
        coordinates: { latitude, longitude },
        count: results.length,
        results,
        usageGuidance:
          "Reverse geocoding is approximate and must not be treated as proof of ownership or affiliation.",
        timestamp: timestamp(),
      });
    },
  );
}
