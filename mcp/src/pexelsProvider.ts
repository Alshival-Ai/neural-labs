import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  open,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ProviderConfig } from "./providerConfig.js";

const PEXELS_ROOT = "https://api.pexels.com/v1";
const REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const TOKEN_LIFETIME_SECONDS = 60 * 60;
const MEDIA_HOSTS = new Set([
  "www.pexels.com",
  "images.pexels.com",
  "static-videos.pexels.com",
  "videos.pexels.com",
  "player.vimeo.com",
]);
const ORIENTATIONS = new Set(["landscape", "portrait", "square"]);
const VIDEO_SIZES = new Set(["large", "medium", "small"]);
const PHOTO_COLORS = new Set([
  "red",
  "orange",
  "yellow",
  "green",
  "turquoise",
  "blue",
  "violet",
  "pink",
  "brown",
  "black",
  "gray",
  "white",
]);
const PROJECT_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_TYPES = new Set(["video/mp4"]);

type JsonObject = Record<string, unknown>;
type MediaKind = "photo" | "video";
interface DownloadClaim {
  version: 1;
  expiresAt: number;
  kind: MediaKind;
  mediaId: number;
  url: string;
  pageUrl: string;
  creatorName: string;
  creatorUrl: string;
  attributionText: string;
  query: string;
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

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0
    ? value
    : undefined;
}

function safeMediaUrl(value: unknown): string | undefined {
  const raw = cleanText(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      !MEDIA_HOSTS.has(url.hostname) ||
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

function normalizeChoice(
  value: string | undefined,
  allowed: Set<string>,
  field: string,
): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!allowed.has(normalized)) {
    throw new Error(
      field + " must be one of: " + [...allowed].sort().join(", "),
    );
  }
  return normalized;
}

function normalizeColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    PHOTO_COLORS.has(normalized) ||
    /^#[0-9a-f]{6}$/.test(normalized)
  ) {
    return normalized;
  }
  throw new Error("color must be a supported name or six-digit hex color");
}

function creator(
  value: JsonObject,
  kind: MediaKind,
): { name: string; url: string } | undefined {
  if (kind === "photo") {
    const name = cleanText(value.photographer);
    const url = safeMediaUrl(value.photographer_url);
    return name && url ? { name, url } : undefined;
  }
  const user = record(value.user);
  const name = cleanText(user?.name);
  const url = safeMediaUrl(user?.url);
  return name && url ? { name, url } : undefined;
}

function signClaim(claim: DownloadClaim, key: Buffer): string {
  const encoded = Buffer.from(JSON.stringify(claim), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", key)
    .update(encoded)
    .digest("base64url");
  return encoded + "." + signature;
}

function parseClaim(token: string, key: Buffer): DownloadClaim {
  const pieces = token.split(".");
  if (pieces.length !== 2 || !pieces[0] || !pieces[1]) {
    throw new Error("download_token has an invalid format");
  }
  const expected = createHmac("sha256", key)
    .update(pieces[0])
    .digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(pieces[1], "base64url");
  } catch {
    throw new Error("download_token has an invalid signature");
  }
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw new Error("download_token has an invalid signature");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(pieces[0], "base64url").toString("utf8"));
  } catch {
    throw new Error("download_token has an invalid payload");
  }
  const item = record(parsed);
  if (
    item?.version !== 1 ||
    (item.kind !== "photo" && item.kind !== "video") ||
    !positiveInteger(item.mediaId) ||
    typeof item.expiresAt !== "number" ||
    item.expiresAt < Math.floor(Date.now() / 1000) ||
    !safeMediaUrl(item.url) ||
    !safeMediaUrl(item.pageUrl) ||
    !cleanText(item.creatorName) ||
    !safeMediaUrl(item.creatorUrl) ||
    !cleanText(item.attributionText) ||
    !cleanText(item.query)
  ) {
    throw new Error("download_token is expired or invalid");
  }
  return item as unknown as DownloadClaim;
}

function downloadClaim(
  kind: MediaKind,
  mediaId: number,
  url: string,
  pageUrl: string,
  mediaCreator: { name: string; url: string },
  query: string,
  key: Buffer,
): string {
  return signClaim(
    {
      version: 1,
      expiresAt: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
      kind,
      mediaId,
      url,
      pageUrl,
      creatorName: mediaCreator.name,
      creatorUrl: mediaCreator.url,
      attributionText:
        (kind === "photo" ? "Photo by " : "Video by ") +
        mediaCreator.name +
        " on Pexels",
      query,
    },
    key,
  );
}

async function parseJsonResponse(response: Response): Promise<{
  payload: JsonObject;
  rateLimit: JsonObject;
}> {
  if (!response.ok) {
    throw new Error("Pexels request failed with HTTP " + response.status);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_RESPONSE_BYTES
  ) {
    throw new Error("Pexels response exceeded the size limit");
  }
  const raw = new Uint8Array(await response.arrayBuffer());
  if (raw.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Pexels response exceeded the size limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error("Pexels returned invalid JSON");
  }
  const payload = record(parsed);
  if (!payload) throw new Error("Pexels returned an unexpected response");
  const rateLimit: JsonObject = {};
  for (const [header, field] of [
    ["x-ratelimit-limit", "limit"],
    ["x-ratelimit-remaining", "remaining"],
    ["x-ratelimit-reset", "resetEpoch"],
  ] as const) {
    const value = Number(response.headers.get(header) ?? "");
    if (Number.isInteger(value) && value >= 0) rateLimit[field] = value;
  }
  return { payload, rateLimit };
}

async function pexelsRequest(
  apiKey: string,
  endpoint: string,
  params: URLSearchParams,
  fetchFn: typeof globalThis.fetch,
): Promise<{ payload: JsonObject; rateLimit: JsonObject }> {
  const url = new URL(PEXELS_ROOT + "/" + endpoint);
  url.search = params.toString();
  try {
    const response = await fetchFn(url, {
      headers: {
        Accept: "application/json",
        Authorization: apiKey,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await parseJsonResponse(response);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Pexels")) {
      throw error;
    }
    throw new Error("Pexels request could not reach the provider");
  }
}

function normalizePhoto(
  value: unknown,
  query: string,
  signingKey: Buffer,
): JsonObject | undefined {
  const item = record(value);
  const id = positiveInteger(item?.id);
  const pageUrl = safeMediaUrl(item?.url);
  const mediaCreator = item ? creator(item, "photo") : undefined;
  const sources = record(item?.src);
  if (!item || !id || !pageUrl || !mediaCreator || !sources) return undefined;
  const previewUrls: Record<string, string> = {};
  for (const name of [
    "tiny",
    "medium",
    "large",
    "large2x",
    "landscape",
    "portrait",
  ]) {
    const url = safeMediaUrl(sources[name]);
    if (url) previewUrls[name] = url;
  }
  const downloadUrl = previewUrls.large2x ?? previewUrls.large;
  if (!downloadUrl) return undefined;
  return {
    id,
    pageUrl,
    creator: mediaCreator,
    alt: cleanText(item.alt)?.slice(0, 500) ?? "",
    previewUrls,
    downloadUrl,
    downloadToken: downloadClaim(
      "photo",
      id,
      downloadUrl,
      pageUrl,
      mediaCreator,
      query,
      signingKey,
    ),
    attributionText: "Photo by " + mediaCreator.name + " on Pexels",
    ...(positiveInteger(item.width) ? { width: item.width } : {}),
    ...(positiveInteger(item.height) ? { height: item.height } : {}),
    ...(/^#[0-9A-Fa-f]{6}$/.test(String(item.avg_color ?? ""))
      ? { averageColor: item.avg_color }
      : {}),
  };
}

function normalizeVideo(
  value: unknown,
  query: string,
  signingKey: Buffer,
): JsonObject | undefined {
  const item = record(value);
  const id = positiveInteger(item?.id);
  const pageUrl = safeMediaUrl(item?.url);
  const posterUrl = safeMediaUrl(item?.image);
  const mediaCreator = item ? creator(item, "video") : undefined;
  if (!item || !id || !pageUrl || !posterUrl || !mediaCreator) return undefined;
  const candidates = Array.isArray(item.video_files)
    ? item.video_files
        .map((raw) => {
          const file = record(raw);
          const url = safeMediaUrl(file?.link);
          const width = positiveInteger(file?.width);
          const height = positiveInteger(file?.height);
          if (
            !file ||
            !url ||
            !width ||
            !height ||
            file.file_type !== "video/mp4" ||
            url.toLowerCase().split("?", 1)[0]?.endsWith(".m3u8")
          ) {
            return undefined;
          }
          return {
            id: file.id,
            quality: cleanText(file.quality) ?? "",
            width,
            height,
            url,
            downloadToken: downloadClaim(
              "video",
              id,
              url,
              pageUrl,
              mediaCreator,
              query,
              signingKey,
            ),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .sort((a, b) => a.width - b.width)
    : [];
  const byWidth = new Map(candidates.map((entry) => [entry.width, entry]));
  const files = [...byWidth.values()];
  if (files.length > 4) {
    const selected = new Set<number>([0, files.length - 1]);
    for (const target of [960, 1280]) {
      let best = 0;
      for (let index = 1; index < files.length; index += 1) {
        if (
          Math.abs((files[index]?.width ?? 0) - target) <
          Math.abs((files[best]?.width ?? 0) - target)
        ) {
          best = index;
        }
      }
      selected.add(best);
    }
    const bounded = [...selected]
      .sort((a, b) => a - b)
      .map((index) => files[index])
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    files.splice(0, files.length, ...bounded);
  }
  if (files.length === 0) return undefined;
  return {
    id,
    pageUrl,
    posterUrl,
    creator: mediaCreator,
    files,
    attributionText: "Video by " + mediaCreator.name + " on Pexels",
    ...(positiveInteger(item.width) ? { width: item.width } : {}),
    ...(positiveInteger(item.height) ? { height: item.height } : {}),
    ...(positiveInteger(item.duration)
      ? { durationSeconds: item.duration }
      : {}),
  };
}

function searchResponse(
  kind: MediaKind,
  query: string,
  page: number,
  requested: number,
  payload: JsonObject,
  rateLimit: JsonObject,
  items: JsonObject[],
): JsonObject {
  return {
    kind,
    query,
    page,
    requestedCount: requested,
    count: items.length,
    totalResults:
      typeof payload.total_results === "number" ? payload.total_results : null,
    results: items,
    rateLimit,
    attributionRequired: true,
    usageGuidance:
      "Review the full choice set. Download selected media into the project, retain creator and Pexels attribution, and never imply stock media depicts the actual business.",
    provider: "Pexels",
    providerUrl: "https://www.pexels.com",
    timestamp: new Date().toISOString(),
  };
}

function mcpValue(result: JsonObject) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function resolveDestination(
  projectsRoot: string,
  projectSlug: string,
  relativePath: string,
): Promise<{ projectRoot: string; destination: string }> {
  if (!PROJECT_SLUG.test(projectSlug)) {
    throw new Error("project_slug must be a DNS-safe single label");
  }
  if (
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    path.posix.normalize(relativePath) !== relativePath ||
    !relativePath.startsWith("site/assets/") ||
    relativePath.endsWith("/")
  ) {
    throw new Error("relative_path must be a normalized path below site/assets");
  }
  const root = await realpath(projectsRoot);
  const project = await realpath(path.join(root, projectSlug));
  if (path.dirname(project) !== root) {
    throw new Error("project directory is outside the managed projects root");
  }
  const projectInfo = await lstat(project);
  if (!projectInfo.isDirectory() || projectInfo.isSymbolicLink()) {
    throw new Error("project directory must be a real directory");
  }
  const site = await realpath(path.join(project, "site"));
  if (path.dirname(site) !== project) {
    throw new Error("project site directory is outside the project");
  }
  const siteInfo = await lstat(site);
  if (!siteInfo.isDirectory() || siteInfo.isSymbolicLink()) {
    throw new Error("project site directory must be a real directory");
  }
  const assets = path.join(site, "assets");
  await mkdir(assets, { recursive: true, mode: 0o750 });
  const assetsReal = await realpath(assets);
  if (path.dirname(assetsReal) !== site) {
    throw new Error("project assets directory is outside the site");
  }
  const destination = path.join(project, ...relativePath.split("/"));
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true, mode: 0o750 });
  const parentReal = await realpath(parent);
  if (
    parentReal !== assetsReal &&
    !parentReal.startsWith(assetsReal + path.sep)
  ) {
    throw new Error("download destination is outside site/assets");
  }
  if (await pathExists(destination)) {
    throw new Error("download destination already exists");
  }
  return { projectRoot: project, destination };
}

function expectedMedia(
  claim: DownloadClaim,
  relativePath: string,
): { types: Set<string>; limit: number } {
  const extension = path.extname(relativePath).toLowerCase();
  if (claim.kind === "photo") {
    if (!new Set([".jpg", ".jpeg", ".png", ".webp"]).has(extension)) {
      throw new Error("photo destination must use jpg, jpeg, png, or webp");
    }
    return { types: IMAGE_TYPES, limit: MAX_IMAGE_BYTES };
  }
  if (extension !== ".mp4") {
    throw new Error("video destination must use mp4");
  }
  return { types: VIDEO_TYPES, limit: MAX_VIDEO_BYTES };
}

async function fetchDownload(
  initialUrl: string,
  fetchFn: typeof globalThis.fetch,
): Promise<Response> {
  let url = initialUrl;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetchFn(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const next = location ? safeMediaUrl(new URL(location, url).toString()) : undefined;
      if (!next) throw new Error("Pexels download returned an unsafe redirect");
      url = next;
      continue;
    }
    if (!response.ok) {
      throw new Error("Pexels download failed with HTTP " + response.status);
    }
    return response;
  }
  throw new Error("Pexels download exceeded the redirect limit");
}

async function downloadMedia(
  claim: DownloadClaim,
  projectSlug: string,
  relativePath: string,
  config: ProviderConfig,
  fetchFn: typeof globalThis.fetch,
): Promise<JsonObject> {
  const expected = expectedMedia(claim, relativePath);
  const { projectRoot, destination } = await resolveDestination(
    config.projectsRoot,
    projectSlug,
    relativePath,
  );
  const temporary = path.join(
    path.dirname(destination),
    "." + path.basename(destination) + "." + randomUUID() + ".tmp",
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let installed = false;
  let completed = false;
  try {
    const response = await fetchDownload(claim.url, fetchFn);
    const mediaType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (!mediaType || !expected.types.has(mediaType)) {
      throw new Error("Pexels download returned an unexpected media type");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > expected.limit
    ) {
      throw new Error("Pexels download exceeded the file size limit");
    }
    if (!response.body) throw new Error("Pexels download returned no content");
    handle = await open(temporary, "wx", 0o640);
    const digest = createHash("sha256");
    const reader = response.body.getReader();
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > expected.limit) {
        await reader.cancel();
        throw new Error("Pexels download exceeded the file size limit");
      }
      digest.update(chunk.value);
      await handle.write(chunk.value);
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    // A hard link is an atomic no-replace install on the same filesystem.
    // Unlike rename(2), it cannot silently overwrite a path created after the
    // initial destination check.
    await link(temporary, destination);
    installed = true;
    const sha256 = digest.digest("hex");
    const provenance = {
      schemaVersion: 1,
      provider: "Pexels",
      kind: claim.kind,
      mediaId: claim.mediaId,
      query: claim.query,
      pageUrl: claim.pageUrl,
      sourceUrl: claim.url,
      creator: { name: claim.creatorName, url: claim.creatorUrl },
      attributionText: claim.attributionText,
      relativePath,
      bytes,
      sha256,
      mediaType,
      downloadedAt: new Date().toISOString(),
    };
    const metadataDirectory = path.join(
      projectRoot,
      ".neural-labs",
      "media",
    );
    await mkdir(metadataDirectory, { recursive: true, mode: 0o750 });
    const metadataReal = await realpath(metadataDirectory);
    const projectReal = await realpath(projectRoot);
    if (!metadataReal.startsWith(projectReal + path.sep)) {
      throw new Error("media metadata directory is outside the project");
    }
    const metadataPath = path.join(metadataDirectory, sha256 + ".json");
    if (!(await pathExists(metadataPath))) {
      await writeFile(
        metadataPath,
        JSON.stringify(provenance, null, 2) + "\n",
        { encoding: "utf8", mode: 0o640, flag: "wx" },
      );
    }
    const result = {
      status: "downloaded",
      projectSlug,
      relativePath,
      bytes,
      sha256,
      mediaType,
      attributionText: claim.attributionText,
      provenancePath: path.relative(projectRoot, metadataPath).split(path.sep).join("/"),
    };
    completed = true;
    return result;
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    if (installed && !completed) {
      await rm(destination, { force: true }).catch(() => undefined);
    }
  }
}

export function registerPexelsTools(
  server: McpServer,
  config: ProviderConfig,
  fetchFn: typeof globalThis.fetch,
): void {
  if (!config.pexelsApiKey) return;
  const apiKey = config.pexelsApiKey;
  const sharedSchema = {
    query: z.string().trim().min(1).max(160),
    limit: z.number().int().default(12),
    orientation: z.string().optional(),
    page: z.number().int().min(1).max(100).default(1),
  };

  server.registerTool(
    "pexels_search_photos",
    {
      title: "Search Pexels photos",
      description:
        "Search Pexels for a bounded set of conceptual photos with attribution and safe project-download tokens.",
      inputSchema: z.object({
        ...sharedSchema,
        color: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ query, limit, orientation, color, page }) => {
      const requested = normalizeLimit(limit);
      const params = new URLSearchParams({
        query,
        per_page: String(requested),
        page: String(page),
        locale: "en-US",
      });
      const normalizedOrientation = normalizeChoice(
        orientation,
        ORIENTATIONS,
        "orientation",
      );
      if (normalizedOrientation) {
        params.set("orientation", normalizedOrientation);
      }
      const normalizedColor = normalizeColor(color);
      if (normalizedColor) params.set("color", normalizedColor);
      const { payload, rateLimit } = await pexelsRequest(
        apiKey,
        "search",
        params,
        fetchFn,
      );
      const results = (Array.isArray(payload.photos) ? payload.photos : [])
        .map((item) =>
          normalizePhoto(item, query, config.downloadSigningKey),
        )
        .filter((item): item is JsonObject => Boolean(item));
      return mcpValue(
        searchResponse(
          "photo",
          query,
          page,
          requested,
          payload,
          rateLimit,
          results,
        ),
      );
    },
  );

  server.registerTool(
    "pexels_search_videos",
    {
      title: "Search Pexels videos",
      description:
        "Search Pexels for bounded progressive MP4 choices with attribution and safe project-download tokens.",
      inputSchema: z.object({
        ...sharedSchema,
        size: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ query, limit, orientation, size, page }) => {
      const requested = normalizeLimit(limit);
      const params = new URLSearchParams({
        query,
        per_page: String(requested),
        page: String(page),
        locale: "en-US",
      });
      const normalizedOrientation = normalizeChoice(
        orientation,
        ORIENTATIONS,
        "orientation",
      );
      if (normalizedOrientation) {
        params.set("orientation", normalizedOrientation);
      }
      const normalizedSize = normalizeChoice(size, VIDEO_SIZES, "size");
      if (normalizedSize) params.set("size", normalizedSize);
      const { payload, rateLimit } = await pexelsRequest(
        apiKey,
        "videos/search",
        params,
        fetchFn,
      );
      const results = (Array.isArray(payload.videos) ? payload.videos : [])
        .map((item) =>
          normalizeVideo(item, query, config.downloadSigningKey),
        )
        .filter((item): item is JsonObject => Boolean(item));
      return mcpValue(
        searchResponse(
          "video",
          query,
          page,
          requested,
          payload,
          rateLimit,
          results,
        ),
      );
    },
  );

  server.registerTool(
    "pexels_download_media",
    {
      title: "Download selected Pexels media",
      description:
        "Download one signed Pexels search selection into an existing project's site/assets tree and record provenance.",
      inputSchema: z.object({
        download_token: z.string().min(64).max(16_384),
        project_slug: z.string().regex(PROJECT_SLUG),
        relative_path: z.string().min(1).max(512),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ download_token, project_slug, relative_path }) =>
      mcpValue(
        await downloadMedia(
          parseClaim(download_token, config.downloadSigningKey),
          project_slug,
          relative_path,
          config,
          fetchFn,
        ),
      ),
  );
}
