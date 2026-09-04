import { readFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";

import { BuilderError, attachBuilderWebSocket, createBuilderManager } from "./builder-manager.mjs";
import { createWorkspaceFileEvents } from "./file-events.mjs";
import { WorkspaceFileError, createFileManager } from "./file-manager.mjs";
import { WorkspaceSkillError, createSkillsManager, workspaceSkillActor } from "./skills-manager.mjs";
import {
  TERMINAL_SOCKET_PATH,
  TERMINAL_SOCKET_PROTOCOL,
  TerminalError,
  WorkspaceTerminalManager,
  attachTerminalWebSocket,
  terminalActor,
} from "./terminal-manager.mjs";
import {
  VSCODE_BASE_PATH,
  attachVsCodeWebSocketBridge,
  proxyVsCodeHttp,
} from "./vscode-proxy.mjs";

const ASSET_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

const CSP_NONCE_MARKER = "__NEURAL_LABS_CSP_NONCE__";
const PREVIEW_PREFIX = "/workspace/preview/";
const PREVIEW_LAUNCH_PATH = "/workspace/api/previews";
const PREVIEW_LAUNCH_TTL_MS = 15 * 60 * 1000;
// @xterm/xterm 6.0.0 creates two library-global styles outside its
// documentOverride path: an initially empty shared sheet and its pinned base
// rules. Keep these exact hashes in sync with the pinned xterm dependency.
const XTERM_GLOBAL_STYLE_HASHES = [
  "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='",
  "'sha256-0HLsQTd9pfKPyap6Gal6YdqwXATwb28CEdo/XWqlODU='",
];

function contentSecurityPolicy(nonce) {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `style-src-elem 'self' 'nonce-${nonce}' ${XTERM_GLOBAL_STYLE_HASHES.join(" ")}`,
    // xterm positions its canvas, viewport, textarea, and cursor through
    // element.style. Executable inline scripts remain forbidden.
    "style-src-attr 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join("; ");
}

function previewContentSecurityPolicy(assetSource) {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
    `font-src ${assetSource} data:`,
    `img-src ${assetSource} data: blob:`,
    `media-src ${assetSource} data: blob:`,
    "object-src 'none'",
    `script-src ${assetSource} 'unsafe-inline' 'unsafe-eval' blob:`,
    `style-src ${assetSource} 'unsafe-inline'`,
    `worker-src ${assetSource} blob:`,
    "sandbox allow-scripts allow-modals allow-downloads",
  ].join("; ");
}

function send(response, status, body, type, method, cacheControl = "no-store") {
  response.setHeader("Cache-Control", cacheControl);
  response.setHeader("Content-Type", type);
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.writeHead(status);
  response.end(method === "HEAD" ? undefined : body);
}

function sendJson(response, status, value, method = "GET") {
  send(
    response,
    status,
    JSON.stringify(value),
    "application/json; charset=utf-8",
    method,
  );
}

function skillApiError(response, error, method) {
  if (error instanceof WorkspaceSkillError) {
    sendJson(response, error.status, { error: { code: error.code, message: error.message } }, method);
    return;
  }
  console.error("Workspace skill API error", error instanceof Error ? error.message : error);
  sendJson(response, 500, { error: { code: "internal_error", message: "The skill operation failed" } }, method);
}

function builderApiError(response, error, method) {
  if (error instanceof BuilderError || error instanceof WorkspaceSkillError) {
    sendJson(response, error.status, { error: { code: error.code, message: error.message } }, method);
    return;
  }
  console.error("Workspace builder API error", error instanceof Error ? error.message : error);
  sendJson(response, 500, { error: { code: "internal_error", message: "The builder operation failed" } }, method);
}

function validControlToken(request, expected) {
  const authorization = request.headers.authorization ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer);
}

function resolveAsset(pathname) {
  const prefix = "/workspace/assets/";
  if (!pathname.startsWith(prefix)) return null;
  const filename = pathname.slice(prefix.length);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename)) return null;
  const extension = filename.slice(filename.lastIndexOf("."));
  const type = ASSET_TYPES.get(extension);
  return type ? { filename, type } : null;
}

function assetCacheControl(filename) {
  if (/-[a-zA-Z0-9_-]{8,}\./.test(filename)) return "public, max-age=31536000, immutable";
  if (/^wallpaper(?:-tablet|-mobile)?\.(?:png|webp)$/.test(filename)) {
    return "public, max-age=86400, stale-while-revalidate=604800";
  }
  return "public, max-age=3600, stale-while-revalidate=86400";
}

function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function parsePreviewRequest(pathname) {
  const encoded = pathname.slice(PREVIEW_PREFIX.length);
  const separator = encoded.indexOf("/");
  if (separator < 1) {
    throw new WorkspaceFileError(404, "preview_not_found", "This preview is unavailable");
  }
  const launchToken = encoded.slice(0, separator);
  if (!/^[A-Za-z0-9_-]{32}$/.test(launchToken)) {
    throw new WorkspaceFileError(404, "preview_not_found", "This preview is unavailable");
  }
  try {
    const rawPath = encoded.slice(separator + 1);
    const requestedPath = decodeURIComponent(rawPath || "index.html");
    return {
      launchToken,
      path: requestedPath.endsWith("/") ? `${requestedPath}index.html` : requestedPath,
    };
  } catch {
    throw new WorkspaceFileError(400, "invalid_preview", "The preview website path is invalid");
  }
}

function inlinePreviewAvailable(mimeType) {
  return mimeType.startsWith("image/") ||
    mimeType.startsWith("audio/") ||
    mimeType.startsWith("video/") ||
    mimeType === "application/pdf" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType.startsWith("text/csv");
}

function previewByteRange(value, size) {
  if (typeof value !== "string") return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2]) || size < 1) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function sendInlinePreview(response, file, method, rangeHeader) {
  if (!inlinePreviewAvailable(file.mimeType)) {
    throw new WorkspaceFileError(415, "preview_unavailable", "This file type is not available in Preview");
  }
  const range = previewByteRange(rangeHeader, file.size);
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Content-Disposition", "inline");
  response.setHeader("Content-Type", file.mimeType);
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Last-Modified", file.modifiedAt.toUTCString());
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Accept-Ranges", "bytes");
  if (file.mimeType === "image/svg+xml") {
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  }
  if (range === false) {
    response.setHeader("Content-Range", `bytes */${file.size}`);
    response.setHeader("Content-Length", 0);
    response.writeHead(416);
    response.end();
    return;
  }
  const length = range ? range.end - range.start + 1 : file.size;
  response.setHeader("Content-Length", length);
  if (range) response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`);
  response.writeHead(range ? 206 : 200);
  if (method === "HEAD") response.end();
  else file.stream(range || undefined).on("error", () => response.destroy()).pipe(response);
}

function sendPreview(response, file, method, assetSource) {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Content-Length", file.size);
  response.setHeader("Content-Type", file.mimeType);
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (file.mimeType.startsWith("text/html")) {
    response.setHeader("Content-Security-Policy", previewContentSecurityPolicy(assetSource));
  }
  response.writeHead(200);
  if (method === "HEAD") response.end();
  else file.stream().on("error", () => response.destroy()).pipe(response);
}

async function readJsonBody(request, limit = 8192) {
  const chunks = [];
  let size = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > limit) throw new WorkspaceFileError(413, "request_too_large", "The request is too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new WorkspaceFileError(400, "invalid_json", "The request body must be valid JSON");
  }
}

async function readTextBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > limit) {
      throw new WorkspaceFileError(413, "text_too_large", `Editor files must be ${Math.floor(limit / 1024 / 1024)} MB or smaller`);
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.includes(0)) {
    throw new WorkspaceFileError(415, "invalid_text", "The Editor supports UTF-8 text files without null bytes");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new WorkspaceFileError(415, "invalid_text", "The Editor supports UTF-8 text files");
  }
}

function fileApiError(response, error, method) {
  if (error instanceof WorkspaceFileError) {
    sendJson(response, error.status, { error: { code: error.code, message: error.message } }, method);
    return;
  }
  console.error("Workspace file API error", error instanceof Error ? error.message : error);
  sendJson(response, 500, { error: { code: "internal_error", message: "The workspace file operation failed" } }, method);
}

function terminalApiError(response, error, method) {
  if (error instanceof TerminalError) {
    sendJson(response, error.status, { error: { code: error.code, message: error.message } }, method);
    return;
  }
  console.error("Workspace terminal API error", error instanceof Error ? error.message : error);
  sendJson(response, 500, { error: { code: "internal_error", message: "The terminal operation failed" } }, method);
}

export function createWorkspaceHttpServer({
  desktopRoot,
  workspaceRoot,
  publicOrigin,
  gatewayReady,
  codeServerOrigin = "http://127.0.0.1:18881",
  codeServerReady = async () => true,
  mcpStatus = async () => ({
    ready: true,
    mode: "workspace-local",
    endpoint: "http://127.0.0.1:8792/mcp",
    transport: "streamable-http",
    agentServerName: "neural-labs-tools",
    agentScope: "shared-workspace",
    publicAccess: false,
    providers: { googlePlaces: false, googleGeocoding: false, klipy: false, pexels: false },
    tools: [],
  }),
  providerAuthenticated,
  openclawModelReady,
  providerAuth,
  personalOpenAI,
  workspaceControlToken,
  openclawVersion,
  codexVersion,
  maxUploadBytes,
  maxTextBytes,
  personalSkillsRoot = path.join(path.dirname(workspaceRoot), ".agents", "skills"),
  teamSkillsRoot = path.join(workspaceRoot, "skills"),
  skillInstructionRoots = [
    workspaceRoot,
    personalSkillsRoot,
    path.join(path.dirname(workspaceRoot), ".openclaw", "skills"),
    "/app/skills",
    "/app/extensions",
  ],
  builderDraftsRoot = path.join(path.dirname(workspaceRoot), ".local", "state", "neural-labs", "builder-drafts"),
  terminalManager,
  runTeamAgent,
}) {
  const files = createFileManager({ root: workspaceRoot, maxUploadBytes, maxTextBytes });
  const skills = createSkillsManager({
    personalRoot: personalSkillsRoot,
    teamRoot: teamSkillsRoot,
    instructionRoots: skillInstructionRoots,
  });
  const builder = createBuilderManager({
    root: builderDraftsRoot,
    publishSkill: (actor, skillPackage, targetKey) => skills.savePackage(actor, skillPackage, targetKey),
  });
  const fileEvents = createWorkspaceFileEvents({ root: workspaceRoot });
  const terminals = terminalManager ?? new WorkspaceTerminalManager({ workspaceRoot });
  const previewLaunches = new Map();
  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://workspace.local");
    const pathname = url.pathname;
    const providerRoute = pathname === "/internal/provider-auth/openai";
    const providerStartRoute = pathname === "/internal/provider-auth/openai/start";
    const providerCancelRoute = pathname === "/internal/provider-auth/openai/cancel";
    const personalProviderMatch = pathname.match(/^\/internal\/provider-auth\/openai\/users\/([^/]+)(?:\/(start|cancel|pause|resume))?$/u);
    const teamAgentRoute = pathname === "/internal/neura/team-run";
    if (teamAgentRoute) {
      if (!runTeamAgent || !workspaceControlToken || !validControlToken(request, workspaceControlToken)) {
        sendJson(response, 401, { error: { code: "unauthorized", message: "Unauthorized" } }, method);
        return;
      }
      if (method !== "POST") {
        response.setHeader("Allow", "POST");
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } }, method);
        return;
      }
      try {
        const body = await readJsonBody(request, 2 * 1024 * 1024);
        const result = await runTeamAgent({ prompt: body?.prompt, capability: body?.capability, userId: body?.userId, runId: body?.runId });
        sendJson(response, 200, typeof result === "string" ? { reply: result } : result, method);
      } catch (error) {
        console.error("Team Chat agent run failed", error instanceof Error ? error.message : error);
        const personalAccountRequired = error?.code === "personal_openai_required";
        sendJson(response, personalAccountRequired ? 409 : 502, { error: { code: personalAccountRequired ? "personal_openai_required" : "agent_run_failed", message: personalAccountRequired ? error.message : "Neura could not complete this Team Chat turn" } }, method);
      }
      return;
    }
    if (personalProviderMatch) {
      if (!personalOpenAI || !workspaceControlToken || !validControlToken(request, workspaceControlToken)) {
        sendJson(response, 401, { error: { code: "unauthorized", message: "Unauthorized" } }, method);
        return;
      }
      let userId;
      try {
        userId = decodeURIComponent(personalProviderMatch[1]);
      } catch {
        sendJson(response, 400, { error: { code: "invalid_user", message: "Invalid user identifier" } }, method);
        return;
      }
      const action = personalProviderMatch[2];
      if ((!action && method !== "GET") || (action && method !== "POST")) {
        response.setHeader("Allow", action ? "POST" : "GET");
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } }, method);
        return;
      }
      try {
        const result = !action ? await personalOpenAI.snapshot(userId)
          : action === "start" ? await personalOpenAI.start(userId)
          : action === "cancel" ? await personalOpenAI.cancel(userId)
          : action === "pause" ? await personalOpenAI.pause(userId)
          : await personalOpenAI.resume(userId);
        sendJson(response, action === "start" ? 202 : 200, result, method);
      } catch (error) {
        console.error("Personal OpenAI account operation failed", error instanceof Error ? error.message : error);
        sendJson(response, 409, { error: { code: "personal_openai_unavailable", message: error instanceof Error ? error.message : "Personal OpenAI account operation failed" } }, method);
      }
      return;
    }
    if (providerRoute || providerStartRoute || providerCancelRoute) {
      if (!providerAuth || !workspaceControlToken || !validControlToken(request, workspaceControlToken)) {
        sendJson(response, 401, { error: { code: "unauthorized", message: "Unauthorized" } }, method);
        return;
      }
      if (providerRoute && method === "GET") {
        sendJson(response, 200, providerAuth.snapshot(), method);
        return;
      }
      if (providerStartRoute && method === "POST") {
        sendJson(response, 202, providerAuth.start(), method);
        return;
      }
      if (providerCancelRoute && method === "POST") {
        sendJson(response, 200, providerAuth.cancel(), method);
        return;
      }
      response.setHeader("Allow", providerRoute ? "GET" : "POST");
      sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } }, method);
      return;
    }

    if (pathname === VSCODE_BASE_PATH || pathname.startsWith(`${VSCODE_BASE_PATH}/`)) {
      proxyVsCodeHttp(request, response, { codeServerOrigin, publicOrigin });
      return;
    }

    if (pathname === PREVIEW_LAUNCH_PATH) {
      const userId = typeof request.headers["x-forwarded-user"] === "string" ? request.headers["x-forwarded-user"].trim() : "";
      if (!userId) {
        sendJson(response, 401, { error: { code: "unauthorized", message: "Authentication is required" } }, method);
        return;
      }
      if (method !== "POST") {
        response.setHeader("Allow", "POST");
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } }, method);
        return;
      }
      if (request.headers.origin !== publicOrigin) {
        sendJson(response, 403, { error: { code: "same_origin_required", message: "A same-origin request is required" } }, method);
        return;
      }
      try {
        const body = await readJsonBody(request, 16 * 1024);
        const root = typeof body?.root === "string" ? body.root : "";
        const entry = typeof body?.entry === "string" ? body.entry : "index.html";
        const verification = await files.preview(root, entry);
        verification.stream().destroy();
        const now = Date.now();
        for (const [token, launch] of previewLaunches) if (launch.expiresAt <= now) previewLaunches.delete(token);
        const launchToken = randomBytes(24).toString("base64url");
        const expiresAt = now + PREVIEW_LAUNCH_TTL_MS;
        previewLaunches.set(launchToken, { userId, root, expiresAt });
        const encodedEntry = entry.split("/").map((segment) => encodeURIComponent(segment)).join("/");
        sendJson(response, 201, { url: `${PREVIEW_PREFIX}${launchToken}/${encodedEntry}`, expiresAt: new Date(expiresAt).toISOString() }, method);
      } catch (error) {
        fileApiError(response, error, method);
      }
      return;
    }

    if (pathname.startsWith(PREVIEW_PREFIX)) {
      const userId = typeof request.headers["x-forwarded-user"] === "string" ? request.headers["x-forwarded-user"].trim() : "";
      if (method !== "GET" && method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } }, method);
        return;
      }
      try {
        const preview = parsePreviewRequest(pathname);
        const launch = previewLaunches.get(preview.launchToken);
        if (!launch || (userId && launch.userId !== userId) || launch.expiresAt <= Date.now()) {
          if (launch?.expiresAt <= Date.now()) previewLaunches.delete(preview.launchToken);
          throw new WorkspaceFileError(404, "preview_not_found", "This preview is unavailable");
        }
        launch.expiresAt = Date.now() + PREVIEW_LAUNCH_TTL_MS;
        const file = await files.preview(launch.root, preview.path);
        const assetSource = new URL(`${PREVIEW_PREFIX}${preview.launchToken}/`, publicOrigin).href;
        sendPreview(response, file, method, assetSource);
      } catch (error) {
        fileApiError(response, error, method);
      }
      return;
    }

    if (pathname === "/workspace/api/terminals" ||
        pathname === "/workspace/api/terminals/socket" ||
        /^\/workspace\/api\/terminals\/[^/]+\/ticket$/.test(pathname) ||
        /^\/workspace\/api\/terminals\/[^/]+$/.test(pathname)) {
      const actor = terminalActor(request.headers);
      if (!actor) {
        sendJson(response, 401, { error: { code: "unauthorized", message: "Authentication is required" } }, method);
        return;
      }
      const mutation = method === "POST" || method === "DELETE";
      if (mutation && request.headers.origin !== publicOrigin) {
        sendJson(response, 403, { error: { code: "same_origin_required", message: "A same-origin request is required" } }, method);
        return;
      }
      try {
        if (pathname === "/workspace/api/terminals" && method === "GET") {
          sendJson(response, 200, { sessions: terminals.list(actor) }, method);
          return;
        }
        if (pathname === "/workspace/api/terminals" && method === "POST") {
          const body = await readJsonBody(request);
          sendJson(response, 201, { session: terminals.create(actor, body) }, method);
          return;
        }
        const ticketMatch = pathname.match(/^\/workspace\/api\/terminals\/([^/]+)\/ticket$/);
        if (ticketMatch && method === "POST") {
          const body = await readJsonBody(request);
          const issued = terminals.issueTicket(actor, decodeURIComponent(ticketMatch[1]), body?.afterSequence);
          sendJson(response, 200, {
            ...issued,
            path: TERMINAL_SOCKET_PATH,
            protocol: TERMINAL_SOCKET_PROTOCOL,
          }, method);
          return;
        }
        const terminalMatch = pathname.match(/^\/workspace\/api\/terminals\/([^/]+)$/);
        if (terminalMatch && method === "DELETE") {
          const closed = terminals.close(actor, decodeURIComponent(terminalMatch[1]));
          if (!closed) throw new TerminalError(404, "terminal_not_found", "Terminal session not found");
          sendJson(response, 200, { closed: true }, method);
          return;
        }
        response.setHeader("Allow", pathname === "/workspace/api/terminals" ? "GET, POST" : pathname.endsWith("/ticket") ? "POST" : "DELETE");
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } }, method);
      } catch (error) {
        terminalApiError(response, error, method);
      }
      return;
    }

    if (pathname === "/workspace/api/builder/drafts" || /^\/workspace\/api\/builder\/drafts\/[^/]+(?:\/(?:collaborators|asset|validate|publish|automation-published|test-snapshot))?$/.test(pathname)) {
      const actor = workspaceSkillActor(request.headers);
      if (!actor) {
        sendJson(response, 401, { error: { code: "unauthorized", message: "Authentication is required" } }, method);
        return;
      }
      const mutation = method !== "GET" && method !== "HEAD";
      if (mutation && request.headers.origin !== publicOrigin) {
        sendJson(response, 403, { error: { code: "same_origin_required", message: "A same-origin request is required" } }, method);
        return;
      }
      try {
        if (pathname === "/workspace/api/builder/drafts" && method === "GET") {
          sendJson(response, 200, { drafts: await builder.list(actor) }, method);
          return;
        }
        if (pathname === "/workspace/api/builder/drafts" && method === "POST") {
          sendJson(response, 201, { draft: await builder.create(actor, await readJsonBody(request, 512 * 1024)) }, method);
          return;
        }
        const match = pathname.match(/^\/workspace\/api\/builder\/drafts\/([^/]+)(?:\/(collaborators|asset|validate|publish|automation-published|test-snapshot))?$/);
        if (!match) throw new BuilderError(404, "draft_not_found", "Builder draft not found");
        const draftId = decodeURIComponent(match[1]);
        const action = match[2];
        if (!action && method === "GET") {
          sendJson(response, 200, await builder.get(actor, draftId), method);
          return;
        }
        if (!action && method === "DELETE") {
          await builder.discard(actor, draftId);
          sendJson(response, 200, { discarded: true }, method);
          return;
        }
        if (action === "collaborators" && method === "PUT") {
          const body = await readJsonBody(request);
          sendJson(response, 200, { draft: await builder.collaborators(actor, draftId, body?.userIds) }, method);
          return;
        }
        if (action === "asset" && method === "POST") {
          sendJson(response, 201, { asset: await builder.saveAsset(actor, draftId, await readJsonBody(request, 36 * 1024 * 1024)) }, method);
          return;
        }
        if (action === "asset" && method === "DELETE") {
          await builder.removeAsset(actor, draftId, url.searchParams.get("path") ?? "");
          sendJson(response, 200, { removed: true }, method);
          return;
        }
        if (action === "validate" && method === "POST") {
          sendJson(response, 200, await builder.validate(actor, draftId), method);
          return;
        }
        if (action === "publish" && method === "POST") {
          sendJson(response, 200, await builder.publish(actor, draftId), method);
          return;
        }
        if (action === "automation-published" && method === "POST") {
          sendJson(response, 200, { draft: await builder.finalizeAutomation(actor, draftId, await readJsonBody(request)) }, method);
          return;
        }
        if (action === "test-snapshot" && method === "POST") {
          sendJson(response, 201, { test: await builder.testSnapshot(actor, draftId, await readJsonBody(request, 64 * 1024)) }, method);
          return;
        }
        response.setHeader("Allow", action ? "POST, PUT, DELETE" : "GET, DELETE");
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } }, method);
      } catch (error) {
        builderApiError(response, error, method);
      }
      return;
    }

    if (pathname === "/workspace/api/skills" || /^\/workspace\/api\/skills\/[^/]+$/.test(pathname) || /^\/workspace\/api\/skills\/[^/]+\/scope$/.test(pathname) || /^\/workspace\/api\/skills\/[^/]+\/package$/.test(pathname)) {
      const actor = workspaceSkillActor(request.headers);
      if (!actor) {
        sendJson(response, 401, { error: { code: "unauthorized", message: "Authentication is required" } }, method);
        return;
      }
      const mutation = method === "POST" || method === "PUT";
      if (mutation && request.headers.origin !== publicOrigin) {
        sendJson(response, 403, { error: { code: "same_origin_required", message: "A same-origin request is required" } }, method);
        return;
      }
      try {
        if (pathname === "/workspace/api/skills/instructions" && method === "GET") {
          sendJson(response, 200, await skills.readInstruction(url.searchParams.get("path") ?? ""), method);
          return;
        }
        if (pathname === "/workspace/api/skills" && method === "GET") {
          sendJson(response, 200, { skills: await skills.list(actor) }, method);
          return;
        }
        if (pathname === "/workspace/api/skills" && method === "POST") {
          sendJson(response, 201, { skill: await skills.save(actor, await readJsonBody(request, 256 * 1024)) }, method);
          return;
        }
        const packageMatch = pathname.match(/^\/workspace\/api\/skills\/([^/]+)\/package$/);
        if (packageMatch && method === "GET") {
          sendJson(response, 200, await skills.readPackage(actor, decodeURIComponent(packageMatch[1])), method);
          return;
        }
        const scopeMatch = pathname.match(/^\/workspace\/api\/skills\/([^/]+)\/scope$/);
        if (scopeMatch && method === "PUT") {
          const body = await readJsonBody(request);
          sendJson(response, 200, { skill: await skills.share(actor, decodeURIComponent(scopeMatch[1]), body?.scope) }, method);
          return;
        }
        const skillMatch = pathname.match(/^\/workspace\/api\/skills\/([^/]+)$/);
        if (skillMatch && method === "PUT") {
          sendJson(response, 200, { skill: await skills.save(actor, await readJsonBody(request, 256 * 1024), decodeURIComponent(skillMatch[1])) }, method);
          return;
        }
        response.setHeader("Allow", pathname === "/workspace/api/skills" ? "GET, POST" : packageMatch ? "GET" : "PUT");
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } }, method);
      } catch (error) {
        skillApiError(response, error, method);
      }
      return;
    }

    if (pathname === "/workspace/api/files" ||
        pathname === "/workspace/api/files/folders" ||
        pathname === "/workspace/api/files/upload" ||
        pathname === "/workspace/api/files/content" ||
        pathname === "/workspace/api/files/download" ||
        pathname === "/workspace/api/files/text" ||
        pathname === "/workspace/api/files/events") {
      if (typeof request.headers["x-forwarded-user"] !== "string" || !request.headers["x-forwarded-user"].trim()) {
        sendJson(response, 401, { error: { code: "unauthorized", message: "Authentication is required" } }, method);
        return;
      }
      const mutation = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
      if (mutation && request.headers.origin !== publicOrigin) {
        sendJson(response, 403, { error: { code: "same_origin_required", message: "A same-origin request is required" } }, method);
        return;
      }
      try {
        const requestedPath = url.searchParams.get("path") ?? "";
        if (pathname === "/workspace/api/files/events" && method === "GET") {
          fileEvents.subscribe(response);
          return;
        }
        if (pathname === "/workspace/api/files/text" && method === "GET") {
          sendJson(response, 200, await files.readText(requestedPath), method);
          return;
        }
        if (pathname === "/workspace/api/files/text" && method === "POST") {
          const content = await readTextBody(request, files.maxTextBytes);
          const result = await files.createText(requestedPath, url.searchParams.get("name"), content);
          sendJson(response, 201, result, method);
          return;
        }
        if (pathname === "/workspace/api/files/text" && method === "PUT") {
          const content = await readTextBody(request, files.maxTextBytes);
          const result = await files.writeText(requestedPath, content, url.searchParams.get("version"));
          sendJson(response, 200, result, method);
          return;
        }
        if (pathname === "/workspace/api/files" && method === "GET") {
          sendJson(response, 200, await files.list(requestedPath), method);
          return;
        }
        if (pathname === "/workspace/api/files" && method === "DELETE") {
          sendJson(response, 200, await files.remove(requestedPath), method);
          return;
        }
        if (pathname === "/workspace/api/files/folders" && method === "POST") {
          const body = await readJsonBody(request);
          const item = await files.createFolder(
            typeof body?.path === "string" ? body.path : "",
            body?.name,
          );
          sendJson(response, 201, { item }, method);
          return;
        }
        if (pathname === "/workspace/api/files/upload" && method === "POST") {
          const item = await files.upload(requestedPath, url.searchParams.get("name"), request);
          sendJson(response, 201, { item }, method);
          return;
        }
        if (pathname === "/workspace/api/files/download" && (method === "GET" || method === "HEAD")) {
          const file = await files.download(requestedPath);
          response.setHeader("Cache-Control", "private, no-store");
          response.setHeader("Content-Type", file.mimeType);
          response.setHeader("Content-Length", file.size);
          response.setHeader("Content-Disposition", contentDisposition(file.name));
          response.setHeader("Last-Modified", file.modifiedAt.toUTCString());
          response.setHeader("X-Content-Type-Options", "nosniff");
          response.writeHead(200);
          if (method === "HEAD") response.end();
          else file.stream().on("error", () => response.destroy()).pipe(response);
          return;
        }
        if (pathname === "/workspace/api/files/content" && (method === "GET" || method === "HEAD")) {
          sendInlinePreview(response, await files.download(requestedPath), method, request.headers.range);
          return;
        }
        response.setHeader("Allow", pathname === "/workspace/api/files/download" || pathname === "/workspace/api/files/content" ? "GET, HEAD" : pathname === "/workspace/api/files/events" ? "GET" : pathname === "/workspace/api/files/text" ? "GET, POST, PUT" : pathname === "/workspace/api/files" ? "GET, DELETE" : "POST");
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } }, method);
      } catch (error) {
        fileApiError(response, error, method);
      }
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      send(response, 405, "Method not allowed\n", "text/plain; charset=utf-8", method);
      return;
    }

    if (pathname === "/status" || pathname === "/healthz") {
      const [gatewayIsReady, codeServerIsReady, mcp] = await Promise.all([
        gatewayReady(),
        codeServerReady(),
        mcpStatus(),
      ]);
      const mcpIsReady = mcp.ready;
      const ready = gatewayIsReady && codeServerIsReady && mcpIsReady;
      const providerReady = providerAuthenticated();
      const body = JSON.stringify({
        status: ready ? "ready" : "starting",
        gatewayReady: gatewayIsReady,
        codeServerReady: codeServerIsReady,
        mcpReady: mcpIsReady,
        mcp,
        openclawVersion,
        codexVersion,
        providerAuthenticated: providerReady,
        codexAuthenticated: providerReady,
        openclawModelReady: openclawModelReady(),
      });
      send(
        response,
        pathname === "/healthz" && !ready ? 503 : 200,
        body,
        "application/json; charset=utf-8",
        method,
      );
      return;
    }

    try {
      if (pathname === "/workspace" || pathname === "/workspace/") {
        const template = await readFile(`${desktopRoot}/index.html`, "utf8");
        if (!template.includes(CSP_NONCE_MARKER)) {
          throw new Error("Workspace desktop index is missing its CSP nonce marker");
        }
        const nonce = randomBytes(18).toString("base64");
        const body = template.replace(CSP_NONCE_MARKER, nonce);
        response.setHeader("Content-Security-Policy", contentSecurityPolicy(nonce));
        response.setHeader("Referrer-Policy", "same-origin");
        response.setHeader("X-Frame-Options", "DENY");
        send(response, 200, body, "text/html; charset=utf-8", method);
        return;
      }

      const asset = resolveAsset(pathname);
      if (asset) {
        const body = await readFile(`${desktopRoot}/assets/${asset.filename}`);
        send(
          response,
          200,
          body,
          asset.type,
          method,
          assetCacheControl(asset.filename),
        );
        return;
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        send(response, 404, "Not found\n", "text/plain; charset=utf-8", method);
        return;
      }
      console.error("Workspace desktop file error", error instanceof Error ? error.message : error);
      send(response, 500, "Internal server error\n", "text/plain; charset=utf-8", method);
      return;
    }

    send(response, 404, "Not found\n", "text/plain; charset=utf-8", method);
  });
  const terminalSockets = attachTerminalWebSocket(server, { manager: terminals, publicOrigin });
  const vsCodeSockets = attachVsCodeWebSocketBridge(server, { codeServerOrigin, publicOrigin });
  const builderSockets = attachBuilderWebSocket(server, { manager: builder, publicOrigin });
  const closeServer = server.close.bind(server);
  let closed = false;
  server.close = (callback) => {
    if (!closed) {
      closed = true;
      fileEvents.close();
      terminalSockets.close();
      vsCodeSockets.close();
      builderSockets.close();
      void builder.close();
      terminals.shutdown();
    }
    return closeServer(callback);
  };
  return server;
}
