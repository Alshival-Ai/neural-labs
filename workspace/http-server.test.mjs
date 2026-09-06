import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";
import { WebSocket } from "ws";

import { createWorkspaceHttpServer } from "./http-server.mjs";

const mcpStatusFixture = (ready = true) => ({
  ready,
  mode: "workspace-local",
  endpoint: "http://127.0.0.1:8792/mcp",
  transport: "streamable-http",
  agentServerName: "neural-labs-tools",
  agentScope: "shared-workspace",
  publicAccess: false,
  providers: { googlePlaces: true, googleGeocoding: true, klipy: true, pexels: true },
  tools: ["google_places_search", "search_gif", "pexels_search_photos"],
});

async function fixture(ready = true, { maxUploadBytes, maxTextBytes, mcpReady = true, codeServerReady = true, runTeamAgent, personalOpenAI, modelCatalog, modelPolicies, teamOpenAI, voiceService, turnCredentialProvider, teamChannelAuthorizer, terminalHeartbeatMs, gatewayMediaOrigin, gatewayMediaFetch, terminalActorResolver, gifProvider, apiProviderRuntime } = {}) {
  const desktopRoot = await mkdtemp(path.join(tmpdir(), "neural-labs-desktop-test-"));
  const workspaceRoot = path.join(desktopRoot, "workspace-root");
  await mkdir(path.join(desktopRoot, "assets"));
  await mkdir(path.join(workspaceRoot, "projects"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "projects", "site"), { recursive: true });
  await writeFile(path.join(workspaceRoot, "notes.md"), "shared notes\n");
  await writeFile(path.join(workspaceRoot, "projects", "app.js"), "export {};\n");
  await writeFile(path.join(workspaceRoot, "projects", "site", "index.html"), "<!doctype html><button id=proof>Preview works</button><script>proof.onclick=()=>proof.textContent='Clicked'</script>");
  await writeFile(path.join(workspaceRoot, "projects", "site", "styles.css"), "button { color: rebeccapurple; }\n");
  await writeFile(path.join(desktopRoot, "index.html"), "<!doctype html><meta name=\"csp-nonce\" content=\"__NEURAL_LABS_CSP_NONCE__\"><title>Desktop · Neural Labs</title>");
  await writeFile(path.join(desktopRoot, "assets", "index-a1b2c3d4.css"), "body { color: white; }");
  await writeFile(path.join(desktopRoot, "assets", "index-a1b2c3d4.js"), "document.title = document.title;");
  await writeFile(path.join(desktopRoot, "assets", "wallpaper.png"), Buffer.from([137, 80, 78, 71]));
  await writeFile(path.join(desktopRoot, "assets", "wallpaper-tablet.png"), Buffer.from([137, 80, 78, 71]));
  await writeFile(path.join(desktopRoot, "assets", "wallpaper-mobile.png"), Buffer.from([137, 80, 78, 71]));
  await mkdir(path.join(desktopRoot, "image-editor", "dist"), { recursive: true });
  await writeFile(path.join(desktopRoot, "image-editor", "index.html"), '<script src="dist/bundle.js"></script>');
  await writeFile(path.join(desktopRoot, "image-editor", "dist", "bundle.js"), '"use strict";');
  const server = createWorkspaceHttpServer({
    desktopRoot,
    workspaceRoot,
    publicOrigin: "https://neural-labs.example.com",
    gatewayReady: async () => ready,
    gatewayMediaOrigin,
    gatewayMediaFetch,
    codeServerReady: async () => codeServerReady,
    mcpStatus: async () => mcpStatusFixture(mcpReady),
    providerAuthenticated: () => false,
    openclawModelReady: () => false,
    providerAuth: {
      snapshot: () => ({ provider: "openai", state: "disconnected" }),
      start: () => ({ provider: "openai", state: "starting" }),
      cancel: () => ({ provider: "openai", state: "disconnected" }),
    },
    personalOpenAI,
    modelCatalog,
    modelPolicies,
    teamOpenAI,
    voiceService,
    workspaceControlToken: "workspace-control-token-at-least-thirty-two-characters",
    openclawVersion: "2026.8.2",
    codexVersion: "0.152.0",
    maxUploadBytes,
    maxTextBytes,
    runTeamAgent,
    turnCredentialProvider,
    teamChannelAuthorizer,
    terminalHeartbeatMs,
    terminalActorResolver,
    gifProvider,
    apiProviderRuntime,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    workspaceRoot,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await rm(desktopRoot, { recursive: true, force: true });
    },
  };
}

test("protects model control routes and preserves owner/workload routing", async () => {
  const calls = [];
  const app = await fixture(true, {
    modelCatalog: { invalidate: () => {}, list: async (input) => { calls.push(input); return { models: [] }; } },
    modelPolicies: {
      inspect: async (userId, workload) => ({ userId, workload }),
      apply: async (input) => { calls.push(input); return { model: "openai/test" }; },
    },
    teamOpenAI: { snapshot: async () => ({ authenticated: false }), start: async () => ({ state: "starting" }), cancel: () => ({ state: "disconnected" }) },
    voiceService: { snapshot: () => ({ configured: true }), configure: (input) => input, refreshCatalog: async () => ({ refreshed: true }) },
  });
  const headers = { Authorization: "Bearer workspace-control-token-at-least-thirty-two-characters", "Content-Type": "application/json" };
  try {
    for (const route of ["catalog", "preferences", "team/connection", "voice"]) {
      assert.equal((await fetch(`${app.origin}/internal/model-providers/${route}`)).status, 401);
      assert.equal((await fetch(`${app.origin}/internal/model-providers/${route}`, { method: "DELETE", headers })).status, 405);
    }
    await fetch(`${app.origin}/internal/model-providers/catalog?userId=alice`, { method: "POST", headers });
    assert.deepEqual(calls.pop(), { userId: "alice", agentId: undefined, refresh: true });
    const scoped = await fetch(`${app.origin}/internal/model-providers/preferences?userId=alice&workload=team`, { headers }).then((response) => response.json());
    assert.deepEqual(scoped, { userId: "alice", workload: "background" });
    await fetch(`${app.origin}/internal/model-providers/preferences?workload=team`, { method: "POST", headers, body: JSON.stringify({ policy: { mode: "latest" }, revision: 2 }) });
    assert.deepEqual(calls.pop(), { userId: undefined, workload: "team", policy: { mode: "latest" }, revision: 2, previous: undefined });
    assert.equal((await fetch(`${app.origin}/internal/model-providers/team/connection/start`, { method: "POST", headers })).status, 202);
    assert.deepEqual(await fetch(`${app.origin}/internal/model-providers/voice/refresh`, { method: "POST", headers }).then((response) => response.json()), { refreshed: true });
  } finally { await app.close(); }
});

test("isolates public editor assets from authenticated Files APIs and personal metadata", async () => {
  const app = await fixture();
  const user = { "X-Forwarded-User": "alice" };
  const mutation = { ...user, Origin: "https://neural-labs.example.com", "Content-Type": "application/json" };
  try {
    const editor = await fetch(`${app.origin}/workspace/image-editor/index.html`);
    assert.equal(editor.status, 200);
    assert.match(editor.headers.get("content-security-policy"), /sandbox allow-scripts/);
    assert.doesNotMatch(editor.headers.get("content-security-policy"), /allow-same-origin/);
    assert.match(editor.headers.get("content-security-policy"), /connect-src 'none'/);
    assert.equal(editor.headers.get("access-control-allow-origin"), "*");
    assert.equal((await fetch(`${app.origin}/workspace/image-editor/notes.md`)).status, 404);
    for (const endpoint of ["preferences", "recent", "search?q=notes", "trash", "operations", "info?path=notes.md"]) {
      assert.equal((await fetch(`${app.origin}/workspace/api/files/${endpoint}`)).status, 401);
    }
    assert.equal((await fetch(`${app.origin}/workspace/api/files/preferences`, { method: "PUT", headers: user, body: "{}" })).status, 403);
    const saved = await fetch(`${app.origin}/workspace/api/files/preferences`, { method: "PUT", headers: mutation, body: JSON.stringify({ revision: 0, pins: [{ path: "projects", label: "Projects" }] }) });
    assert.equal(saved.status, 200);
    const other = await fetch(`${app.origin}/workspace/api/files/preferences`, { headers: { "X-Forwarded-User": "bob" } }).then((r) => r.json());
    assert.deepEqual(other.pins, []);
    const job = await fetch(`${app.origin}/workspace/api/files/operations`, { method: "POST", headers: mutation, body: JSON.stringify({ items: [{ action: "copy", path: "notes.md", destination: "projects" }] }) }).then((r) => r.json());
    assert.ok(job.id);
    assert.equal((await fetch(`${app.origin}/workspace/api/files/operations/${job.id}`, { headers: { "X-Forwarded-User": "bob" } })).status, 404);
    let result;
    do { await new Promise((r) => setTimeout(r, 5)); result = await fetch(`${app.origin}/workspace/api/files/operations/${job.id}`, { headers: user }).then((r) => r.json()); } while (["queued", "running"].includes(result.state));
    assert.equal(result.results[0].status, "completed");
    const info = await fetch(`${app.origin}/workspace/api/files/info?path=notes.md`, { headers: user }).then((r) => r.json());
    assert.ok(info.item.version);
    const stale = await fetch(`${app.origin}/workspace/api/files/binary?path=&name=notes.md&version=wrong`, { method: "PUT", headers: mutation, body: "bad overwrite" });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error.code, "stale_file");
  } finally { await app.close(); }
});

test("brokers authenticated same-origin private voice and team transcription requests", async () => {
  const calls = [];
  const app = await fixture(true, {
    voiceService: {
      createRealtimeCall: async (input) => {
        calls.push({ type: "realtime", ...input });
        return "v=0\r\no=answer\r\n";
      },
      transcribeVoiceMemo: async (input) => {
        calls.push({ type: "transcription", ...input });
        return "Recorded team update";
      },
    },
  });
  try {
    const unauthenticated = await fetch(`${app.origin}/workspace/api/neura/realtime/call`, { method: "POST", body: "v=0\r\n" });
    assert.equal(unauthenticated.status, 401);

    const wrongOrigin = await fetch(`${app.origin}/workspace/api/neura/realtime/call`, {
      method: "POST",
      headers: { "X-Forwarded-User": "maya-id", Origin: "https://wrong.example" },
      body: "v=0\r\n",
    });
    assert.equal(wrongOrigin.status, 403);

    const realtime = await fetch(`${app.origin}/workspace/api/neura/realtime/call`, {
      method: "POST",
      headers: { "X-Forwarded-User": "maya-id", Origin: "https://neural-labs.example.com", "Content-Type": "application/sdp" },
      body: "v=0\r\no=offer\r\n",
    });
    assert.equal(realtime.status, 201);
    assert.equal(realtime.headers.get("content-type"), "application/sdp");
    assert.equal(realtime.headers.get("x-neural-labs-voice-max-seconds"), "300");
    assert.equal(await realtime.text(), "v=0\r\no=answer\r\n");

    const transcription = await fetch(`${app.origin}/workspace/api/neura/transcriptions`, {
      method: "POST",
      headers: { "X-Forwarded-User": "maya-id", Origin: "https://neural-labs.example.com", "Content-Type": "audio/webm" },
      body: Buffer.from("memo"),
    });
    assert.equal(transcription.status, 200);
    assert.deepEqual(await transcription.json(), { text: "Recorded team update" });
    assert.equal(calls[0].userId, "maya-id");
    assert.equal(calls[0].offer, "v=0\r\no=offer\r\n");
    assert.equal(calls[1].userId, "maya-id");
    assert.equal(calls[1].mimeType, "audio/webm");
    assert.deepEqual(calls[1].bytes, Buffer.from("memo"));
  } finally {
    await app.close();
  }
});

test("relays only authenticated, ticketed Neura media through the workspace origin", async () => {
  const requests = [];
  const ticket = "v1.c2Vzc2lvbi1ib3VuZC10aWNrZXQ.c2lnbmF0dXJl";
  const route = `/workspace/api/neura/media/outgoing/${encodeURIComponent("agent:nl-user:dashboard:chat")}/7ecda889-9f92-4cef-a162-5e6a56ad6abc/full?mediaTicket=${ticket}`;
  const app = await fixture(true, {
    gatewayMediaOrigin: "http://127.0.0.1:18789",
    gatewayMediaFetch: async (url, init) => {
      requests.push({ url: String(url), method: init.method, authorization: init.headers?.authorization });
      return new Response(Buffer.from([137, 80, 78, 71]), {
        headers: { "Content-Type": "image/png", "Content-Length": "4", "Content-Disposition": "inline; filename=generated.png" },
      });
    },
  });
  try {
    assert.equal((await fetch(`${app.origin}${route}`)).status, 401);
    assert.equal((await fetch(`${app.origin}${route.replace(`?mediaTicket=${ticket}`, "")}`, { headers: { "X-Forwarded-User": "maya-id" } })).status, 404);
    const response = await fetch(`${app.origin}${route}`, { headers: { "X-Forwarded-User": "maya-id" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([137, 80, 78, 71]));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `http://127.0.0.1:18789/api/chat/media/outgoing/${encodeURIComponent("agent:nl-user:dashboard:chat")}/7ecda889-9f92-4cef-a162-5e6a56ad6abc/full?mediaTicket=${ticket}`);
    assert.equal(requests[0].authorization, undefined);
  } finally {
    await app.close();
  }
});

test("serves the desktop shell and its allowlisted assets", async () => {
  const app = await fixture();
  try {
    const desktop = await fetch(`${app.origin}/workspace`);
    assert.equal(desktop.status, 200);
    const policy = desktop.headers.get("content-security-policy");
    assert.match(policy, /frame-ancestors 'none'/);
    assert.match(policy, /style-src-attr 'unsafe-inline'/);
    assert.match(policy, /worker-src 'self' blob:/);
    const desktopBody = await desktop.text();
    assert.match(desktopBody, /Desktop · Neural Labs/);
    const nonce = desktopBody.match(/name="csp-nonce" content="([^"]+)"/)?.[1];
    assert.ok(nonce);
    assert.equal(desktopBody.includes("__NEURAL_LABS_CSP_NONCE__"), false);
    assert.equal(policy.includes(`style-src-elem 'self' 'nonce-${nonce}'`), true);
    assert.equal(policy.includes("'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='"), true);
    assert.equal(policy.includes("'sha256-0HLsQTd9pfKPyap6Gal6YdqwXATwb28CEdo/XWqlODU='"), true);

    const secondDesktop = await fetch(`${app.origin}/workspace`).then((response) => response.text());
    const secondNonce = secondDesktop.match(/name="csp-nonce" content="([^"]+)"/)?.[1];
    assert.ok(secondNonce);
    assert.notEqual(secondNonce, nonce);

    const asset = await fetch(`${app.origin}/workspace/assets/index-a1b2c3d4.css`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type"), /^text\/css/);
    assert.match(asset.headers.get("cache-control"), /immutable/);

    const wallpaper = await fetch(`${app.origin}/workspace/assets/wallpaper.png`);
    assert.equal(wallpaper.status, 200);
    assert.equal(wallpaper.headers.get("content-type"), "image/png");
    assert.match(wallpaper.headers.get("cache-control"), /max-age=86400/);
    assert.match(wallpaper.headers.get("cache-control"), /stale-while-revalidate=604800/);

    for (const variant of ["wallpaper-tablet.png", "wallpaper-mobile.png"]) {
      const response = await fetch(`${app.origin}/workspace/assets/${variant}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
    }
  } finally {
    await app.close();
  }
});

const workspaceHeaders = { "X-Forwarded-User": "user-1" };
const workspaceMutationHeaders = {
  ...workspaceHeaders,
  Origin: "https://neural-labs.example.com",
};

test("serves authenticated SKILL.md instructions only from approved skill roots", async () => {
  const app = await fixture();
  const skillDirectory = path.join(app.workspaceRoot, "skills", "built-in-test");
  const instructionPath = path.join(skillDirectory, "SKILL.md");
  const outsideDirectory = path.join(path.dirname(app.workspaceRoot), "private-skill");
  const outsidePath = path.join(outsideDirectory, "SKILL.md");
  try {
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(instructionPath, "---\nname: built-in-test\n---\n\n# Built in test\n\nFollow the live instructions.\n");
    await mkdir(outsideDirectory, { recursive: true });
    await writeFile(outsidePath, "# Must stay private\n");

    const endpoint = `${app.origin}/workspace/api/skills/instructions?path=${encodeURIComponent(instructionPath)}`;
    assert.equal((await fetch(endpoint)).status, 401);
    const response = await fetch(endpoint, { headers: workspaceHeaders });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.path, instructionPath);
    assert.match(payload.content, /Follow the live instructions/);

    const outside = await fetch(`${app.origin}/workspace/api/skills/instructions?path=${encodeURIComponent(outsidePath)}`, { headers: workspaceHeaders });
    assert.equal(outside.status, 403);
    assert.equal(JSON.stringify(await outside.json()).includes("Must stay private"), false);

    const linkedPath = path.join(skillDirectory, "linked", "SKILL.md");
    await mkdir(path.dirname(linkedPath), { recursive: true });
    await symlink(outsidePath, linkedPath);
    assert.equal((await fetch(`${app.origin}/workspace/api/skills/instructions?path=${encodeURIComponent(linkedPath)}`, { headers: workspaceHeaders })).status, 400);
  } finally {
    await app.close();
  }
});

test("saves personal skills directly and enforces owner-only sharing", async () => {
  const app = await fixture();
  const mayaHeaders = {
    "X-Forwarded-User": "maya-id",
    "X-Neural-Labs-Email": "maya@example.org",
    Origin: "https://neural-labs.example.com",
    "Content-Type": "application/json",
  };
  const owenHeaders = {
    "X-Forwarded-User": "owen-id",
    "X-Neural-Labs-Email": "owen@example.org",
    Origin: "https://neural-labs.example.com",
    "Content-Type": "application/json",
  };
  try {
    assert.equal((await fetch(`${app.origin}/workspace/api/skills`)).status, 401);
    assert.equal((await fetch(`${app.origin}/workspace/api/skills`, {
      method: "POST",
      headers: { "X-Forwarded-User": "maya-id", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "No origin", description: "Rejected", instructions: "# Rejected", scope: "personal" }),
    })).status, 403);

    const created = await fetch(`${app.origin}/workspace/api/skills`, {
      method: "POST",
      headers: mayaHeaders,
      body: JSON.stringify({
        name: "Customer Handoff",
        description: "Prepare a clear customer handoff.",
        instructions: "# Customer handoff\n\nCapture evidence and an owner.",
        scope: "personal",
      }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.skill.key, "customer-handoff");
    assert.equal(createdBody.skill.ownedByCurrentUser, true);

    const coworkerListing = await fetch(`${app.origin}/workspace/api/skills`, { headers: owenHeaders });
    assert.equal(coworkerListing.status, 200);
    assert.equal((await coworkerListing.json()).skills[0].ownedByCurrentUser, false);

    assert.equal((await fetch(`${app.origin}/workspace/api/skills/customer-handoff/scope`, {
      method: "PUT",
      headers: owenHeaders,
      body: JSON.stringify({ scope: "team" }),
    })).status, 403);

    const shared = await fetch(`${app.origin}/workspace/api/skills/customer-handoff/scope`, {
      method: "PUT",
      headers: mayaHeaders,
      body: JSON.stringify({ scope: "team" }),
    });
    assert.equal(shared.status, 200);
    assert.equal((await shared.json()).skill.scope, "team");
  } finally {
    await app.close();
  }
});

test("serves authorized builder drafts and same-origin collaborative sockets", async () => {
  const app = await fixture();
  const mayaHeaders = {
    "X-Forwarded-User": "maya-id",
    "X-Neural-Labs-Email": "maya@example.org",
    Origin: "https://neural-labs.example.com",
    "Content-Type": "application/json",
  };
  try {
    assert.equal((await fetch(`${app.origin}/workspace/api/builder/drafts`, {
      method: "POST",
      headers: { ...mayaHeaders, Origin: "https://wrong.example.com" },
      body: JSON.stringify({ kind: "skill" }),
    })).status, 403);

    const response = await fetch(`${app.origin}/workspace/api/builder/drafts`, {
      method: "POST",
      headers: mayaHeaders,
      body: JSON.stringify({ kind: "skill", initial: { name: "Socket skill", description: "Exercises collaboration." } }),
    });
    assert.equal(response.status, 201);
    const { draft } = await response.json();

    const collaboratorDenied = await fetch(`${app.origin}/workspace/api/builder/drafts/${draft.id}`, { headers: { "X-Forwarded-User": "owen-id" } });
    assert.equal(collaboratorDenied.status, 403);
    const adminListing = await fetch(`${app.origin}/workspace/api/builder/drafts`, { headers: { "X-Forwarded-User": "admin-id", "X-Neural-Labs-Role": "admin" } });
    assert.equal((await adminListing.json()).drafts.some((item) => item.id === draft.id), true);

    const socketOrigin = app.origin.replace(/^http/, "ws");
    const socket = new WebSocket(`${socketOrigin}/workspace/builder/socket?draftId=${encodeURIComponent(draft.id)}`, "neural-labs-builder-v1", {
      origin: "https://neural-labs.example.com",
      headers: { "X-Forwarded-User": "maya-id", "X-Neural-Labs-Email": "maya@example.org" },
    });
    const messagePromise = once(socket, "message");
    await once(socket, "open");
    const [message] = await messagePromise;
    const sync = JSON.parse(message.toString());
    assert.equal(sync.type, "sync");
    assert.equal(sync.draft.id, draft.id);
    assert.equal(typeof sync.update, "string");
    const closePromise = once(socket, "close");
    socket.close();
    await closePromise;
  } finally {
    await app.close();
  }
});

test("protects the internal Team Chat Neura runner with the workspace control token", async () => {
  const calls = [];
  const app = await fixture(true, {
    runTeamAgent: async (input) => {
      calls.push(input);
      return "Neura team response";
    },
  });
  try {
    const body = JSON.stringify({
      prompt: "Help the release room",
      capability: "channel-capability-at-least-thirty-two-characters",
      userId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
    });
    assert.equal((await fetch(`${app.origin}/internal/neura/team-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })).status, 401);

    const response = await fetch(`${app.origin}/internal/neura/team-run`, {
      method: "POST",
      headers: {
        Authorization: "Bearer workspace-control-token-at-least-thirty-two-characters",
        "Content-Type": "application/json",
      },
      body,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { reply: "Neura team response" });
    assert.deepEqual(calls, [{
      prompt: "Help the release room",
      capability: "channel-capability-at-least-thirty-two-characters",
      userId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
    }]);
  } finally {
    await app.close();
  }
});

test("protects personal OpenAI account control and routes only the selected user", async () => {
  const calls = [];
  const personalOpenAI = {
    snapshot: async (userId) => { calls.push(["snapshot", userId]); return { provider: "openai", state: "disconnected", agentId: "nl-user", paused: true }; },
    start: async (userId) => { calls.push(["start", userId]); return { provider: "openai", state: "starting", agentId: "nl-user", paused: false }; },
    cancel: async () => ({}), pause: async () => ({}), resume: async () => ({}),
    disconnect: async (userId) => { calls.push(["disconnect", userId]); return { state: "disconnected" }; },
  };
  const app = await fixture(true, { personalOpenAI });
  try {
    const path = "/internal/provider-auth/openai/users/11111111-1111-4111-8111-111111111111";
    assert.equal((await fetch(`${app.origin}${path}`)).status, 401);
    const headers = { Authorization: "Bearer workspace-control-token-at-least-thirty-two-characters" };
    assert.equal((await fetch(`${app.origin}${path}`, { headers })).status, 200);
    assert.equal((await fetch(`${app.origin}${path}/start`, { method: "POST", headers })).status, 202);
    assert.equal((await fetch(`${app.origin}${path}/disconnect`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${app.origin}${path}/disconnect`, { method: "POST", headers })).status, 200);
    assert.deepEqual(calls, [
      ["snapshot", "11111111-1111-4111-8111-111111111111"],
      ["start", "11111111-1111-4111-8111-111111111111"],
      ["disconnect", "11111111-1111-4111-8111-111111111111"],
    ]);
  } finally {
    await app.close();
  }
});

async function readServerEvent(response, eventName) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = "";
  const timeout = setTimeout(() => reader.cancel("Timed out waiting for workspace file event"), 3_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`Event stream closed before ${eventName}`);
      content += decoder.decode(value, { stream: true });
      for (const block of content.split("\n\n")) {
        if (!block.startsWith(`event: ${eventName}\n`)) continue;
        const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
        if (data) return JSON.parse(data);
      }
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => undefined);
  }
}

test("confines authenticated file operations to the shared workspace root", async () => {
  const app = await fixture();
  try {
    assert.equal((await fetch(`${app.origin}/workspace/api/files`)).status, 401);

    const listing = await fetch(`${app.origin}/workspace/api/files`, { headers: workspaceHeaders });
    assert.equal(listing.status, 200);
    assert.deepEqual((await listing.json()).entries.map((entry) => [entry.name, entry.type]), [
      ["projects", "folder"],
      ["notes.md", "file"],
    ]);

    assert.equal((await fetch(`${app.origin}/workspace/api/files/folders`, {
      method: "POST",
      headers: { ...workspaceHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "", name: "without-origin" }),
    })).status, 403);

    const folder = await fetch(`${app.origin}/workspace/api/files/folders`, {
      method: "POST",
      headers: { ...workspaceMutationHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "projects", name: "demo" }),
    });
    assert.equal(folder.status, 201);
    assert.equal((await folder.json()).item.path, "projects/demo");

    const upload = await fetch(`${app.origin}/workspace/api/files/upload?path=projects%2Fdemo&name=hello.txt`, {
      method: "POST",
      headers: { ...workspaceMutationHeaders, "Content-Type": "application/octet-stream" },
      body: "hello workspace",
    });
    assert.equal(upload.status, 201);
    assert.equal((await upload.json()).item.size, 15);

    const download = await fetch(`${app.origin}/workspace/api/files/download?path=projects%2Fdemo%2Fhello.txt`, {
      headers: workspaceHeaders,
    });
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition"), /hello\.txt/);
    assert.equal(await download.text(), "hello workspace");

    const removed = await fetch(`${app.origin}/workspace/api/files?path=projects%2Fdemo`, {
      method: "DELETE",
      headers: workspaceMutationHeaders,
    });
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).deleted, true);
    assert.equal((await fetch(`${app.origin}/workspace/api/files?path=projects%2Fdemo`, { headers: workspaceHeaders })).status, 404);

    assert.equal((await fetch(`${app.origin}/workspace/api/files?path=..%2F..%2Fetc`, { headers: workspaceHeaders })).status, 400);
    await symlink("notes.md", path.join(app.workspaceRoot, "notes-link"));
    assert.equal((await fetch(`${app.origin}/workspace/api/files/download?path=notes-link`, { headers: workspaceHeaders })).status, 400);
  } finally {
    await app.close();
  }
});

test("serves authenticated, sandboxed website previews confined to one workspace folder", async () => {
  const app = await fixture();
  try {
    const launchResponse = await fetch(`${app.origin}/workspace/api/previews`, {
      method: "POST",
      headers: { ...workspaceHeaders, Origin: "https://neural-labs.example.com", "Content-Type": "application/json" },
      body: JSON.stringify({ root: "projects/site", entry: "index.html" }),
    });
    assert.equal(launchResponse.status, 201);
    const launch = await launchResponse.json();
    assert.match(launch.url, /^\/workspace\/preview\/[A-Za-z0-9_-]{32}\/index\.html$/);
    const previewBase = `${app.origin}${launch.url.replace(/\/index\.html$/, "")}`;

    const capabilityPage = await fetch(`${previewBase}/`);
    assert.equal(capabilityPage.status, 200);
    assert.match(await capabilityPage.text(), /Preview works/);
    assert.equal((await fetch(`${previewBase}/`, { headers: { "X-Forwarded-User": "user-2" } })).status, 404);
    assert.equal((await fetch(`${app.origin}/workspace/preview/${Buffer.from("projects/site").toString("base64url")}/index.html`, { headers: workspaceHeaders })).status, 404);
    assert.equal((await fetch(`${app.origin}/workspace/api/previews`, { method: "POST", headers: { ...workspaceHeaders, Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" })).status, 403);

    const page = await fetch(`${previewBase}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /^text\/html/);
    assert.equal(page.headers.get("access-control-allow-origin"), null);
    assert.equal(page.headers.get("cache-control"), "private, no-store");
    assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.equal(page.headers.get("x-frame-options"), null);
    const policy = page.headers.get("content-security-policy");
    assert.match(policy, /sandbox allow-scripts/);
    assert.match(policy, /connect-src 'none'/);
    assert.match(policy, /frame-ancestors 'self'/);
    const capabilityAssetSource = `https://neural-labs.example.com${launch.url.replace(/index\.html$/, "")}`;
    assert.ok(policy.includes(`style-src ${capabilityAssetSource} 'unsafe-inline'`));
    assert.ok(policy.includes(`script-src ${capabilityAssetSource} 'unsafe-inline' 'unsafe-eval' blob:`));
    assert.ok(policy.includes(`img-src ${capabilityAssetSource} data: blob:`));
    assert.doesNotMatch(policy, /default-src 'self'/);
    assert.doesNotMatch(policy, /allow-popups/);
    assert.match(await page.text(), /Preview works/);

    const stylesheet = await fetch(`${previewBase}/styles.css`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("content-type"), /^text\/css/);
    assert.equal(await stylesheet.text(), "button { color: rebeccapurple; }\n");

    await writeFile(path.join(app.workspaceRoot, "index.html"), "<!doctype html><h1>Root preview works</h1>");
    const rootLaunch = await fetch(`${app.origin}/workspace/api/previews`, {
      method: "POST",
      headers: { ...workspaceHeaders, Origin: "https://neural-labs.example.com", "Content-Type": "application/json" },
      body: JSON.stringify({ root: "", entry: "index.html" }),
    }).then((response) => response.json());
    const rootPage = await fetch(`${app.origin}${rootLaunch.url}`, { headers: workspaceHeaders });
    assert.equal(rootPage.status, 200);
    assert.match(await rootPage.text(), /Root preview works/);

    const head = await fetch(`${previewBase}/index.html`, { method: "HEAD", headers: workspaceHeaders });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal((await fetch(`${previewBase}/index.html`, { method: "POST", headers: workspaceHeaders })).status, 405);

    const invalidRoot = await fetch(`${app.origin}/workspace/api/previews`, {
      method: "POST",
      headers: { ...workspaceHeaders, Origin: "https://neural-labs.example.com", "Content-Type": "application/json" },
      body: JSON.stringify({ root: "notes.md", entry: "index.html" }),
    });
    assert.equal(invalidRoot.status, 400);
    assert.equal((await invalidRoot.json()).error.code, "not_a_directory");

    const traversal = await fetch(`${previewBase}/%2e%2e%2fnotes.md`, { headers: workspaceHeaders });
    assert.equal(traversal.status, 400);
    assert.equal((await traversal.json()).error.code, "invalid_path");

    await symlink("../../notes.md", path.join(app.workspaceRoot, "projects", "site", "leak.txt"));
    const symlinkResponse = await fetch(`${previewBase}/leak.txt`, { headers: workspaceHeaders });
    assert.equal(symlinkResponse.status, 400);
    assert.equal((await symlinkResponse.json()).error.code, "invalid_path");
  } finally {
    await app.close();
  }
});

test("serves only safe common file types through the authenticated inline preview route", async () => {
  const app = await fixture();
  try {
    await writeFile(path.join(app.workspaceRoot, "projects", "image.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script><rect width=\"10\" height=\"10\"/></svg>");
    await writeFile(path.join(app.workspaceRoot, "projects", "report.xlsx"), Buffer.from([80, 75, 3, 4]));

    assert.equal((await fetch(`${app.origin}/workspace/api/files/content?path=projects%2Fimage.svg`)).status, 401);
    const image = await fetch(`${app.origin}/workspace/api/files/content?path=projects%2Fimage.svg`, { headers: workspaceHeaders });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/svg+xml");
    assert.equal(image.headers.get("content-disposition"), "inline");
    assert.equal(image.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.match(image.headers.get("content-security-policy"), /default-src 'none'/);
    assert.match(image.headers.get("content-security-policy"), /sandbox/);

    const partialImage = await fetch(`${app.origin}/workspace/api/files/content?path=projects%2Fimage.svg`, {
      headers: { ...workspaceHeaders, Range: "bytes=0-3" },
    });
    assert.equal(partialImage.status, 206);
    assert.equal(partialImage.headers.get("accept-ranges"), "bytes");
    assert.match(partialImage.headers.get("content-range"), /^bytes 0-3\//);
    assert.equal(await partialImage.text(), "<svg");
    const invalidRange = await fetch(`${app.origin}/workspace/api/files/content?path=projects%2Fimage.svg`, {
      headers: { ...workspaceHeaders, Range: "bytes=9999-10000" },
    });
    assert.equal(invalidRange.status, 416);
    assert.match(invalidRange.headers.get("content-range"), /^bytes \*\//);

    const workbook = await fetch(`${app.origin}/workspace/api/files/content?path=projects%2Freport.xlsx`, { headers: workspaceHeaders });
    assert.equal(workbook.status, 200);
    assert.equal(workbook.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    const text = await fetch(`${app.origin}/workspace/api/files/content?path=notes.md`, { headers: workspaceHeaders });
    assert.equal(text.status, 415);
    assert.equal((await text.json()).error.code, "preview_unavailable");
    assert.equal((await fetch(`${app.origin}/workspace/api/files/content?path=projects%2Fimage.svg`, { method: "POST", headers: workspaceMutationHeaders })).status, 405);
  } finally {
    await app.close();
  }
});

test("broadcasts external workspace changes to every authenticated Files client", async () => {
  const app = await fixture();
  try {
    assert.equal((await fetch(`${app.origin}/workspace/api/files/events`)).status, 401);

    const first = await fetch(`${app.origin}/workspace/api/files/events`, { headers: workspaceHeaders });
    const second = await fetch(`${app.origin}/workspace/api/files/events`, {
      headers: { "X-Forwarded-User": "user-2" },
    });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(first.headers.get("x-accel-buffering"), "no");
    assert.equal(second.status, 200);

    const firstEvent = readServerEvent(first, "files-changed");
    const secondEvent = readServerEvent(second, "files-changed");
    await writeFile(path.join(app.workspaceRoot, "from-another-user.txt"), "shared immediately\n");

    const [left, right] = await Promise.all([firstEvent, secondEvent]);
    assert.equal(left.sequence, right.sequence);
    assert.deepEqual(left.paths, ["from-another-user.txt"]);
    assert.deepEqual(right.paths, ["from-another-user.txt"]);
  } finally {
    await app.close();
  }
});

test("resolves only authenticated, same-origin workspace paths for VS Code", async () => {
  const app = await fixture();
  const endpoint = `${app.origin}/workspace/api/vscode/open`;
  try {
    assert.equal((await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://neural-labs.example.com" },
      body: JSON.stringify({ path: "notes.md" }),
    })).status, 401);
    assert.equal((await fetch(endpoint, {
      method: "POST",
      headers: { ...workspaceHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "notes.md" }),
    })).status, 403);
    assert.equal((await fetch(endpoint, {
      method: "POST",
      headers: { ...workspaceMutationHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "../outside.txt" }),
    })).status, 400);

    const fileResponse = await fetch(endpoint, {
      method: "POST",
      headers: { ...workspaceMutationHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "notes.md" }),
    });
    assert.equal(fileResponse.status, 200);
    assert.deepEqual(await fileResponse.json(), { opened: { path: "notes.md", type: "file" } });

    const folderResponse = await fetch(endpoint, {
      method: "POST",
      headers: { ...workspaceMutationHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "projects" }),
    });
    assert.equal(folderResponse.status, 200);
    assert.deepEqual(await folderResponse.json(), { opened: { path: "projects", type: "folder" } });
    assert.equal((await fetch(endpoint, { headers: workspaceHeaders })).status, 405);
  } finally {
    await app.close();
  }
});

test("creates, opens, and atomically saves versioned UTF-8 Editor files", async () => {
  const app = await fixture();
  try {
    const opened = await fetch(`${app.origin}/workspace/api/files/text?path=notes.md`, {
      headers: workspaceHeaders,
    });
    assert.equal(opened.status, 200);
    const original = await opened.json();
    assert.equal(original.content, "shared notes\n");
    assert.match(original.version, /^[A-Za-z0-9_-]{43}$/);

    assert.equal((await fetch(`${app.origin}/workspace/api/files/text?path=projects&name=without-origin.md`, {
      method: "POST",
      headers: { ...workspaceHeaders, "Content-Type": "text/plain; charset=utf-8" },
      body: "blocked",
    })).status, 403);

    const created = await fetch(`${app.origin}/workspace/api/files/text?path=projects&name=plan.md`, {
      method: "POST",
      headers: { ...workspaceMutationHeaders, "Content-Type": "text/plain; charset=utf-8" },
      body: "# First plan\n",
    });
    assert.equal(created.status, 201);
    const first = await created.json();
    assert.equal(first.item.path, "projects/plan.md");
    assert.equal(first.content, "# First plan\n");

    const saved = await fetch(`${app.origin}/workspace/api/files/text?path=projects%2Fplan.md&version=${first.version}`, {
      method: "PUT",
      headers: { ...workspaceMutationHeaders, "Content-Type": "text/plain; charset=utf-8" },
      body: "# Revised plan\n",
    });
    assert.equal(saved.status, 200);
    const revised = await saved.json();
    assert.equal(revised.content, "# Revised plan\n");
    assert.notEqual(revised.version, first.version);

    const stale = await fetch(`${app.origin}/workspace/api/files/text?path=projects%2Fplan.md&version=${first.version}`, {
      method: "PUT",
      headers: { ...workspaceMutationHeaders, "Content-Type": "text/plain; charset=utf-8" },
      body: "overwrite newer work\n",
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error.code, "edit_conflict");

    const current = await fetch(`${app.origin}/workspace/api/files/text?path=projects%2Fplan.md`, {
      headers: workspaceHeaders,
    }).then((response) => response.json());
    assert.equal(current.content, "# Revised plan\n");

    await writeFile(path.join(app.workspaceRoot, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    const binary = await fetch(`${app.origin}/workspace/api/files/text?path=binary.bin`, {
      headers: workspaceHeaders,
    });
    assert.equal(binary.status, 415);
    assert.equal((await binary.json()).error.code, "invalid_text");
  } finally {
    await app.close();
  }
});

test("enforces the Editor text size limit", async () => {
  const app = await fixture(true, { maxTextBytes: 4 });
  try {
    const response = await fetch(`${app.origin}/workspace/api/files/text?path=&name=large.txt`, {
      method: "POST",
      headers: { ...workspaceMutationHeaders, "Content-Type": "text/plain; charset=utf-8" },
      body: "12345",
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, "text_too_large");
  } finally {
    await app.close();
  }
});

test("rejects uploads above the configured streaming limit without leaving a file", async () => {
  const app = await fixture(true, { maxUploadBytes: 4 });
  try {
    const response = await fetch(`${app.origin}/workspace/api/files/upload?path=&name=large.bin`, {
      method: "POST",
      headers: workspaceMutationHeaders,
      body: "12345",
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, "upload_too_large");
    const listing = await fetch(`${app.origin}/workspace/api/files`, { headers: workspaceHeaders }).then((value) => value.json());
    assert.equal(listing.entries.some((entry) => entry.name === "large.bin"), false);
  } finally {
    await app.close();
  }
});

test("reports gateway readiness without exposing arbitrary files", async () => {
  const app = await fixture(false);
  try {
    const health = await fetch(`${app.origin}/healthz`);
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), {
      status: "starting",
      gatewayReady: false,
      codeServerReady: true,
      mcpReady: true,
      mcp: mcpStatusFixture(true),
      openclawVersion: "2026.8.2",
      codexVersion: "0.152.0",
      providerAuthenticated: false,
      credentialSource: "unconfigured",
      codexAuthenticated: false,
      openclawModelReady: false,
    });
    assert.equal((await fetch(`${app.origin}/workspace/assets/../index.html`)).status, 404);
    assert.equal((await fetch(`${app.origin}/workspace/assets/%2e%2e%2findex.html`)).status, 404);
    assert.equal((await fetch(`${app.origin}/workspace/assets/.secret`)).status, 404);
    assert.equal((await fetch(`${app.origin}/workspace/assets/missing.js`)).status, 404);
    assert.equal((await fetch(`${app.origin}/workspace/unknown`)).status, 404);
    assert.equal((await fetch(`${app.origin}/workspace`, { method: "POST" })).status, 405);
  } finally {
    await app.close();
  }
});

test("holds workspace readiness while the local MCP is unavailable", async () => {
  const app = await fixture(true, { mcpReady: false });
  try {
    const health = await fetch(`${app.origin}/healthz`);
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), {
      status: "starting",
      gatewayReady: true,
      codeServerReady: true,
      mcpReady: false,
      mcp: mcpStatusFixture(false),
      openclawVersion: "2026.8.2",
      codexVersion: "0.152.0",
      providerAuthenticated: false,
      credentialSource: "unconfigured",
      codexAuthenticated: false,
      openclawModelReady: false,
    });
  } finally {
    await app.close();
  }
});

test("holds workspace readiness while VS Code is starting", async () => {
  const app = await fixture(true, { codeServerReady: false });
  try {
    const health = await fetch(`${app.origin}/healthz`);
    assert.equal(health.status, 503);
    const payload = await health.json();
    assert.equal(payload.status, "starting");
    assert.equal(payload.gatewayReady, true);
    assert.equal(payload.codeServerReady, false);
    assert.equal(payload.mcpReady, true);
  } finally {
    await app.close();
  }
});

test("protects the workspace-owned provider login controller with its internal token", async () => {
  const app = await fixture();
  const headers = {
    Authorization: "Bearer workspace-control-token-at-least-thirty-two-characters",
  };
  try {
    await fetch(`${app.origin}/internal/provider-auth/openai`).then(async (response) => {
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, "unauthorized");
    });
    await fetch(`${app.origin}/internal/provider-auth/openai`, { headers }).then(async (response) => {
      assert.equal(response.status, 200);
      assert.equal((await response.json()).state, "disconnected");
    });
    await fetch(`${app.origin}/internal/provider-auth/openai/start`, { method: "POST", headers }).then(async (response) => {
      assert.equal(response.status, 202);
      assert.equal((await response.json()).state, "starting");
    });
    assert.equal(
      (await fetch(`${app.origin}/internal/provider-auth/openai`, { method: "POST", headers })).status,
      405,
    );
  } finally {
    await app.close();
  }
});

const terminalUserOne = {
  "X-Forwarded-User": "terminal-user-1",
  "X-Neural-Labs-Email": "ada@example.com",
  "X-Neural-Labs-Role": "user",
};
const terminalUserTwo = {
  "X-Forwarded-User": "terminal-user-2",
  "X-Neural-Labs-Email": "grace@example.com",
  "X-Neural-Labs-Role": "user",
};
const terminalOutsider = {
  "X-Forwarded-User": "terminal-user-3",
  "X-Neural-Labs-Email": "linus@example.com",
  "X-Neural-Labs-Role": "user",
};

function waitForSocketMessage(socket, predicate, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for terminal message: ${label}`));
    }, 5_000);
    const onMessage = (raw) => {
      let message;
      try { message = JSON.parse(raw.toString("utf8")); } catch { return; }
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`Terminal socket closed while waiting for: ${label}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("close", onClose);
    };
    socket.on("message", onMessage);
    socket.on("close", onClose);
  });
}

async function createTerminalSession(app, actor, body) {
  const response = await fetch(`${app.origin}/workspace/api/terminals`, {
    method: "POST",
    headers: { ...actor, Origin: "https://neural-labs.example.com", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 201);
  return (await response.json()).session;
}

async function issueTerminalSocketTicket(app, actor, terminalId, afterSequence = null) {
  const response = await fetch(`${app.origin}/workspace/api/terminals/${terminalId}/ticket`, {
    method: "POST",
    headers: { ...actor, Origin: "https://neural-labs.example.com", "Content-Type": "application/json" },
    body: JSON.stringify({ afterSequence }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function connectTerminalSocket(app, actor, ticket) {
  const socket = new WebSocket(
    `${app.origin.replace("http:", "ws:")}${ticket.path}`,
    [ticket.protocol, `ticket.${ticket.ticket}`],
    { origin: "https://neural-labs.example.com", headers: actor },
  );
  const ready = waitForSocketMessage(socket, (message) => message.type === "ready", "ready");
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { socket, ready: await ready };
}

async function rejectedTerminalSocket(app, actor, ticket, origin = "https://neural-labs.example.com") {
  const socket = new WebSocket(
    `${app.origin.replace("http:", "ws:")}${ticket.path}`,
    [ticket.protocol, `ticket.${ticket.ticket}`],
    { origin, headers: actor },
  );
  socket.on("error", () => undefined);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for rejected terminal upgrade")), 3_000);
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timeout);
      response.resume();
      resolve(response.statusCode);
    });
    socket.once("open", () => {
      clearTimeout(timeout);
      socket.close();
      reject(new Error("Rejected terminal socket unexpectedly opened"));
    });
  });
}

test("keeps private PTYs alive across socket reconnects and isolates them by user", async () => {
  const app = await fixture();
  let firstSocket;
  let secondSocket;
  try {
    const session = await createTerminalSession(app, terminalUserOne, { scope: "personal", title: "private work" });
    const otherListing = await fetch(`${app.origin}/workspace/api/terminals`, { headers: terminalUserTwo }).then((response) => response.json());
    assert.deepEqual(otherListing.sessions, []);

    const ticket = await issueTerminalSocketTicket(app, terminalUserOne, session.id);
    assert.equal(await rejectedTerminalSocket(app, terminalUserOne, ticket, "https://attacker.example.com"), 404, "the exact public origin is required");
    const first = await connectTerminalSocket(app, terminalUserOne, ticket);
    firstSocket = first.socket;
    assert.equal(first.ready.session.id, session.id);
    assert.equal(first.ready.session.scope, "personal");
    assert.equal(await rejectedTerminalSocket(app, terminalUserOne, ticket), 403, "a consumed ticket cannot be reused");
    const firstOutput = waitForSocketMessage(firstSocket, (message) => message.type === "output" && message.data.includes("NL_TERMINAL_FIRST"), "first command output");
    firstSocket.send(JSON.stringify({ type: "input", data: "printf 'NL_TERMINAL_FIRST\\n'\n" }));
    const firstChunk = await firstOutput;
    const firstSequence = firstChunk.sequence;
    firstSocket.close(1000, "test reconnect");
    await new Promise((resolve) => firstSocket.once("close", resolve));

    const reconnectTicket = await issueTerminalSocketTicket(app, terminalUserOne, session.id, firstSequence);
    const second = await connectTerminalSocket(app, terminalUserOne, reconnectTicket);
    secondSocket = second.socket;
    assert.equal(second.ready.mode, "resume");
    const secondOutput = waitForSocketMessage(secondSocket, (message) => message.type === "output" && message.data.includes("NL_TERMINAL_SECOND"), "second command output");
    secondSocket.send(JSON.stringify({ type: "input", data: "printf 'NL_TERMINAL_SECOND\\n'\n" }));
    await secondOutput;

    const forbiddenDelete = await fetch(`${app.origin}/workspace/api/terminals/${session.id}`, {
      method: "DELETE",
      headers: { ...terminalUserTwo, Origin: "https://neural-labs.example.com" },
    });
    assert.equal(forbiddenDelete.status, 404);
  } finally {
    firstSocket?.close();
    secondSocket?.close();
    await app.close();
  }
});

test("shares one Team PTY with live input from every participant", async () => {
  const relay = {
    urls: ["turn:neural-labs.example.com:3478?transport=udp", "turn:neural-labs.example.com:3478?transport=tcp"],
    username: "1234567890:test-user",
    credential: "temporary-credential",
  };
  const app = await fixture(true, {
    turnCredentialProvider: async () => [{ urls: ["stun:neural-labs.example.com:3478"] }, relay],
  });
  let ownerSocket;
  let teammateSocket;
  try {
    const session = await createTerminalSession(app, terminalUserOne, { scope: "team", title: "release room" });
    const teammateListing = await fetch(`${app.origin}/workspace/api/terminals`, { headers: terminalUserTwo }).then((response) => response.json());
    assert.equal(teammateListing.sessions.some((candidate) => candidate.id === session.id), true);

    const owner = await connectTerminalSocket(app, terminalUserOne, await issueTerminalSocketTicket(app, terminalUserOne, session.id));
    ownerSocket = owner.socket;
    const teammate = await connectTerminalSocket(app, terminalUserTwo, await issueTerminalSocketTicket(app, terminalUserTwo, session.id));
    teammateSocket = teammate.socket;
    assert.equal(owner.ready.connectionId, owner.ready.session.layoutLeader.connectionId);

    const ownerSeesOutput = waitForSocketMessage(ownerSocket, (message) => message.type === "output" && message.data.includes("NL_TEAM_OWNER"), "owner sees shared output");
    const teammateSeesOutput = waitForSocketMessage(teammateSocket, (message) => message.type === "output" && message.data.includes("NL_TEAM_OWNER"), "teammate sees shared output");
    ownerSocket.send(JSON.stringify({ type: "input", data: "printf 'NL_TEAM_OWNER\\n'\n" }));
    await Promise.all([ownerSeesOutput, teammateSeesOutput]);

    const ownerSeesTeammateOutput = waitForSocketMessage(ownerSocket, (message) => message.type === "output" && message.data.includes("NL_TEAM_TEAMMATE"), "owner sees teammate output");
    const teammateSeesOwnOutput = waitForSocketMessage(teammateSocket, (message) => message.type === "output" && message.data.includes("NL_TEAM_TEAMMATE"), "teammate sees own output");
    teammateSocket.send(JSON.stringify({ type: "input", data: "printf 'NL_TEAM_TEAMMATE\\n'\n" }));
    await Promise.all([ownerSeesTeammateOutput, teammateSeesOwnOutput]);

    const resized = waitForSocketMessage(teammateSocket, (message) => message.type === "layout" && message.cols === 132 && message.rows === 42, "layout leader resizes PTY");
    ownerSocket.send(JSON.stringify({ type: "resize", cols: 132, rows: 42 }));
    await resized;

    const ownerReaction = waitForSocketMessage(ownerSocket, (message) => message.type === "reaction" && message.emoji === "🚀", "owner sees teammate reaction");
    const teammateReaction = waitForSocketMessage(teammateSocket, (message) => message.type === "reaction" && message.emoji === "🚀", "teammate sees own reaction");
    teammateSocket.send(JSON.stringify({ type: "reaction", emoji: "🚀" }));
    await Promise.all([ownerReaction, teammateReaction]);

    const ownerVoiceConfig = waitForSocketMessage(ownerSocket, (message) => message.type === "voice-config", "owner receives temporary TURN configuration");
    const ownerVoiceJoin = waitForSocketMessage(ownerSocket, (message) => message.type === "voice-presence" && message.participants.length === 1, "owner joins voice");
    ownerSocket.send(JSON.stringify({ type: "voice-join", mode: "muted" }));
    const [voiceConfig, ownerVoicePresence] = await Promise.all([ownerVoiceConfig, ownerVoiceJoin]);
    assert.deepEqual(voiceConfig.iceServers[0], { urls: ["stun:neural-labs.example.com:3478"] });
    assert.deepEqual(voiceConfig.iceServers[1], relay);
    assert.equal(ownerVoicePresence.participants[0].connectionId, owner.ready.connectionId);
    assert.equal(ownerVoicePresence.participants[0].mode, "muted");

    const ownerSeesTeammateVoice = waitForSocketMessage(ownerSocket, (message) => message.type === "voice-presence" && message.participants.length === 2, "owner sees teammate join voice");
    const teammateSeesVoiceRoom = waitForSocketMessage(teammateSocket, (message) => message.type === "voice-presence" && message.participants.length === 2, "teammate sees voice room");
    teammateSocket.send(JSON.stringify({ type: "voice-join", mode: "push-to-talk" }));
    await Promise.all([ownerSeesTeammateVoice, teammateSeesVoiceRoom]);

    const relayedOffer = waitForSocketMessage(teammateSocket, (message) => message.type === "voice-signal", "voice offer is relayed only to its target");
    ownerSocket.send(JSON.stringify({
      type: "voice-signal",
      targetConnectionId: teammate.ready.connectionId,
      signal: { description: { type: "offer", sdp: "v=0\r\n" } },
    }));
    const offer = await relayedOffer;
    assert.equal(offer.fromConnectionId, owner.ready.connectionId);
    assert.equal(offer.signal.description.type, "offer");

    const ownerSeesOpenMic = waitForSocketMessage(ownerSocket, (message) => message.type === "voice-presence" && message.participants.some((participant) => participant.connectionId === teammate.ready.connectionId && participant.mode === "open-mic"), "owner sees teammate microphone mode");
    teammateSocket.send(JSON.stringify({ type: "voice-mode", mode: "open-mic" }));
    await ownerSeesOpenMic;

    const ownerSeesVoiceLeave = waitForSocketMessage(ownerSocket, (message) => message.type === "voice-presence" && message.participants.length === 1, "owner sees teammate leave voice");
    teammateSocket.send(JSON.stringify({ type: "voice-leave" }));
    await ownerSeesVoiceLeave;

    const forbiddenDelete = await fetch(`${app.origin}/workspace/api/terminals/${session.id}`, {
      method: "DELETE",
      headers: { ...terminalUserTwo, Origin: "https://neural-labs.example.com" },
    });
    assert.equal(forbiddenDelete.status, 403);
  } finally {
    ownerSocket?.close();
    teammateSocket?.close();
    await app.close();
  }
});

test("limits a Team Chat terminal to current channel members", async () => {
  const channelId = "55555555-5555-4555-8555-555555555555";
  const members = new Set(["terminal-user-1", "terminal-user-2"]);
  const app = await fixture(true, {
    terminalHeartbeatMs: 20,
    teamChannelAuthorizer: async (actor, requestedChannelId) => requestedChannelId === channelId && members.has(actor.id)
      ? { allowed: true, channel: { id: channelId, name: "Private release", audience: "restricted" } }
      : { allowed: false },
  });
  let memberSocket;
  try {
    const forbiddenCreate = await fetch(`${app.origin}/workspace/api/terminals`, {
      method: "POST",
      headers: { ...terminalOutsider, Origin: "https://neural-labs.example.com", "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "team", channelId }),
    });
    assert.equal(forbiddenCreate.status, 404);

    const session = await createTerminalSession(app, terminalUserOne, { scope: "team", channelId });
    assert.deepEqual(session.teamChannel, { id: channelId, name: "Private release" });
    const secondSession = await createTerminalSession(app, terminalUserTwo, { scope: "team", channelId });
    assert.notEqual(secondSession.id, session.id, "the channel can have multiple Team Terminals");

    const memberListing = await fetch(`${app.origin}/workspace/api/terminals`, { headers: terminalUserTwo }).then((response) => response.json());
    assert.equal(memberListing.sessions.some((candidate) => candidate.id === session.id), true);
    assert.equal(memberListing.sessions.some((candidate) => candidate.id === secondSession.id), true);
    const outsiderListing = await fetch(`${app.origin}/workspace/api/terminals`, { headers: terminalOutsider }).then((response) => response.json());
    assert.equal(outsiderListing.sessions.some((candidate) => candidate.id === session.id), false);

    const member = await connectTerminalSocket(app, terminalUserTwo, await issueTerminalSocketTicket(app, terminalUserTwo, session.id));
    memberSocket = member.socket;
    assert.equal(member.ready.session.id, session.id);

    const outsiderTicket = await fetch(`${app.origin}/workspace/api/terminals/${session.id}/ticket`, {
      method: "POST",
      headers: { ...terminalOutsider, Origin: "https://neural-labs.example.com", "Content-Type": "application/json" },
      body: JSON.stringify({ afterSequence: null }),
    });
    assert.equal(outsiderTicket.status, 404);

    const memberRevoked = once(memberSocket, "close");
    members.delete("terminal-user-2");
    const revokedListing = await fetch(`${app.origin}/workspace/api/terminals`, { headers: terminalUserTwo }).then((response) => response.json());
    assert.equal(revokedListing.sessions.some((candidate) => candidate.id === session.id), false);
    await memberRevoked;
  } finally {
    memberSocket?.close();
    await app.close();
  }
});

test("Neura can inspect an existing terminal and launch a masked interactive session through desktop acknowledgment", async () => {
  const actorId = new Headers(terminalUserOne).get("x-forwarded-user");
  const app = await fixture(true, { terminalActorResolver: async (id) => id === actorId ? { id, label: "User", role: "user" } : null });
  const controlHeaders = { "Content-Type": "application/json", Authorization: "Bearer workspace-control-token-at-least-thirty-two-characters" };
  const browserHeaders = { ...terminalUserOne, "Content-Type": "application/json", Origin: "https://neural-labs.example.com" };
  const post = async (route, body, headers = browserHeaders) => {
    const response = await fetch(`${app.origin}${route}`, { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  let socket;
  let interactiveSocket;
  let reader;
  const controller = new AbortController();
  try {
    const existing = await createTerminalSession(app, terminalUserOne, { scope: "personal", title: "Prior work" });
    ({ socket } = await connectTerminalSocket(app, terminalUserOne, await issueTerminalSocketTicket(app, terminalUserOne, existing.id)));
    const output = waitForSocketMessage(socket, (message) => message.type === "output" && message.data.includes("previous-build-failed"), "prior output");
    socket.send(JSON.stringify({ type: "input", data: "printf 'previous-build-failed\\n'\n" }));
    await output;
    const context = await post("/workspace/api/terminal-agent/context", { conversationId: "private-test" });
    assert.equal(context.recentTerminals[0].terminalId, existing.id);
    assert.match(context.recentTerminals[0].output, /previous-build-failed/);
    assert.equal(context.terminalId, undefined);
    const call = (tool, input = {}) => post("/internal/terminal-agent", { tool, input: { ...context, ...input } }, controlHeaders);
    assert.match((await call("read_terminal")).output, /previous-build-failed/);
    const denied = await fetch(`${app.origin}/internal/terminal-agent`, { method: "POST", headers: browserHeaders, body: JSON.stringify({ tool: "list_terminals", input: context }) });
    assert.equal(denied.status, 401);
    const events = await fetch(`${app.origin}/workspace/api/terminal-agent/events?desktopId=acceptance`, { headers: terminalUserOne, signal: controller.signal });
    reader = events.body.getReader();
    await reader.read();
    const launch = call("open_terminal", { requestId: "masked-acceptance", agentMode: "status-only", command: "read -r -s -p 'Secret: ' answer; printf '\\naccepted\\n'" });
    const data = await reader.read();
    const requestId = JSON.parse(new TextDecoder().decode(data.value).split("data: ")[1]).requestId;
    const { session } = await post("/workspace/api/terminal-agent/claim", { requestId, desktopId: "acceptance" });
    ({ socket: interactiveSocket } = await connectTerminalSocket(app, terminalUserOne, await issueTerminalSocketTicket(app, terminalUserOne, session.id)));
    let visible = "";
    interactiveSocket.on("message", (raw) => { const message = JSON.parse(raw); if (message.type === "output") visible += message.data; });
    const prompt = waitForSocketMessage(interactiveSocket, (message) => message.type === "output" && message.data.includes("Secret:"), "masked prompt");
    interactiveSocket.send(JSON.stringify({ type: "client-ready" }));
    await prompt;
    assert.equal((await launch).state, "started");
    const exited = waitForSocketMessage(interactiveSocket, (message) => message.type === "exit", "interactive exit");
    interactiveSocket.send(JSON.stringify({ type: "input", data: "synthetic-private-input\n" }));
    assert.equal((await exited).exitCode, 0);
    assert.ok(!visible.includes("synthetic-private-input"));
    const status = await call("read_terminal", { terminalId: session.id });
    assert.equal(status.output, "");
    assert.equal(status.exitCode, 0);
    assert.equal(status.statusOnly, true);
  } finally {
    socket?.terminate(); interactiveSocket?.terminate();
    await reader?.cancel().catch(() => {}); controller.abort();
    await app.close();
  }
});

test("imports ticketed Neura attachments through Files with conflict handling and confinement", async () => {
  const requests = [];
  const mediaUrl = "/workspace/api/neura/media/outgoing/chat/id/full?mediaTicket=v1.c2Vzc2lvbg.c2lnbmF0dXJl";
  const headers = { "X-Forwarded-User": "attachment-user", Origin: "https://neural-labs.example.com", "Content-Type": "application/json" };
  const app = await fixture(true, { gatewayMediaOrigin: "http://127.0.0.1:18789", gatewayMediaFetch: async (url, options) => {
    requests.push({ url: String(url), redirect: options.redirect }); return new Response("image bytes", { headers: { "Content-Type": "image/png" } });
  } });
  const send = (body, requestHeaders = headers) => fetch(`${app.origin}/workspace/api/files/import-neura`, { method: "POST", headers: requestHeaders, body: JSON.stringify(body) });
  const body = { mediaUrl, destination: "", name: "picture.png" };
  try {
    assert.equal((await send(body, { "Content-Type": "application/json" })).status, 401);
    assert.equal((await send(body, { ...headers, Origin: "https://other.example" })).status, 403);
    assert.equal((await send({ ...body, mediaUrl: "https://example.com/picture.png" })).status, 400);
    assert.equal((await send({ ...body, mediaUrl: mediaUrl + "&url=http://127.0.0.1" })).status, 404);
    assert.equal(requests.length, 0);
    assert.equal((await send(body)).status, 200);
    const conflict = await send(body);
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, "already_exists");
    const kept = await send({ ...body, conflict: "keep-both" });
    assert.equal((await kept.json()).item.path, "picture (2).png");
    assert.equal((await send({ ...body, conflict: "replace" })).status, 200);
    assert.equal((await send({ ...body, destination: "../outside" })).status, 400);
    assert.equal((await send({ ...body, name: "../outside.png" })).status, 400);
    const content = await fetch(`${app.origin}/workspace/api/files/download?path=picture.png`, { headers });
    assert.equal(await content.text(), "image bytes");
    assert.ok(requests.every((r) => r.url === "http://127.0.0.1:18789/api/chat/media/outgoing/chat/id/full?mediaTicket=v1.c2Vzc2lvbg.c2lnbmF0dXJl" && r.redirect === "error"));
    const downloaded = await fetch(`${app.origin}${mediaUrl}&download=1&name=My%20picture.png`, { headers });
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get("content-disposition"), /attachment; filename="My picture.png"/);
  } finally { await app.close(); }
});

test("private media import preserves existing files on expired, oversized, or broken streams", async () => {
  let mode = "expired";
  const app = await fixture(true, { maxUploadBytes: 4, gatewayMediaOrigin: "http://127.0.0.1:18789", gatewayMediaFetch: async () => {
    if (mode === "expired") return new Response("expired", { status: 403 });
    if (mode === "large") return new Response("too many bytes");
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("abc")); controller.error(new Error("connection lost")); } }));
  } });
  const headers = { "X-Forwarded-User": "attachment-user", Origin: "https://neural-labs.example.com", "Content-Type": "application/json" };
  try {
    await writeFile(path.join(app.workspaceRoot, "existing.txt"), "old");
    for (const [value, status] of [["expired", 403], ["large", 413], ["broken", 500]]) {
      mode = value;
      const result = await fetch(`${app.origin}/workspace/api/files/import-neura`, { method: "POST", headers, body: JSON.stringify({ mediaUrl: "/workspace/api/neura/media/outgoing/chat/id/full?mediaTicket=v1.c2Vzc2lvbg.c2lnbmF0dXJl", destination: "", name: "existing.txt", conflict: "replace" }) });
      assert.equal(result.status, status);
      const content = await fetch(`${app.origin}/workspace/api/files/download?path=existing.txt`, { headers });
      assert.equal(await content.text(), "old");
    }
    const listing = await fetch(`${app.origin}/workspace/api/files`, { headers }).then(r => r.json());
    assert.equal(listing.entries.some(entry => entry.name.startsWith(".neural-labs-upload-")), false);
  } finally { await app.close(); }
});

test("aborting a private media import removes staging without replacing the destination", async () => {
  let started;
  const upstreamStarted = new Promise(resolve => { started = resolve; });
  const app = await fixture(true, { gatewayMediaOrigin: "http://127.0.0.1:18789", gatewayMediaFetch: async (_url, options) => {
    started();
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode("partial"));
      options.signal.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
    } }));
  } });
  try {
    await writeFile(path.join(app.workspaceRoot, "keep.txt"), "original");
    const controller = new AbortController();
    const request = fetch(`${app.origin}/workspace/api/files/import-neura`, {
      method: "POST", signal: controller.signal,
      headers: { "X-Forwarded-User": "attachment-user", Origin: "https://neural-labs.example.com", "Content-Type": "application/json" },
      body: JSON.stringify({ mediaUrl: "/workspace/api/neura/media/outgoing/chat/id/full?mediaTicket=v1.c2Vzc2lvbg.c2lnbmF0dXJl", destination: "", name: "keep.txt", conflict: "replace" }),
    });
    const rejected = assert.rejects(request, { name: "AbortError" });
    await upstreamStarted;
    controller.abort();
    await rejected;
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (!(await readdir(app.workspaceRoot)).some(name => name.startsWith(".neural-labs-upload-"))) break;
    }
    assert.equal(await readFile(path.join(app.workspaceRoot, "keep.txt"), "utf8"), "original");
    assert.equal((await readdir(app.workspaceRoot)).some(name => name.startsWith(".neural-labs-upload-")), false);
  } finally { await app.close(); }
});


test("terminal GIF catalog requires authentication and Team access, and socket reactions route only to their session", async () => {
  let allowed = true;
  const gif = { id: "celebrate", title: "Celebrate", url: "https://static.klipy.com/qa.gif", preview: "https://static.klipy.com/qa.gif", still: null };
  const app = await fixture(true, { gifProvider: { configured: true, catalog: async () => ({ results: [gif], next: "page-two" }), share: async () => {} }, teamChannelAuthorizer: async (_actor, id) => ({ allowed, channel: { id, name: "Releases" } }) });
  const sockets = [];
  try {
    const session = await createTerminalSession(app, terminalUserOne, { scope: "team", channelId: "11111111-1111-4111-8111-111111111111" });
    const other = await createTerminalSession(app, terminalUserOne, { scope: "team" });
    const endpoint = `${app.origin}/workspace/api/terminals/${session.id}/gifs?q=celebrate`;
    assert.equal((await fetch(endpoint)).status, 401);
    const response = await fetch(endpoint, { headers: terminalUserOne });
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.equal(page.next, "page-two");
    assert.equal(page.results[0].url, gif.url);
    for (const [actor, id] of [[terminalUserOne, session.id], [terminalUserTwo, session.id], [terminalUserOne, other.id]]) {
      sockets.push((await connectTerminalSocket(app, actor, await issueTerminalSocketTicket(app, actor, id))).socket);
    }
    const unrelated = [];
    sockets[2].on("message", (raw) => { if (JSON.parse(raw).type === "reaction") unrelated.push(raw); });
    const received = sockets.slice(0, 2).map((socket) => waitForSocketMessage(socket, (message) => message.type === "reaction", "GIF broadcast"));
    sockets[0].send(JSON.stringify({ type: "reaction", kind: "gif", token: page.results[0].token }));
    const messages = await Promise.all(received);
    assert.equal(messages[0].id, messages[1].id);
    assert.equal(messages[0].gif.id, "celebrate");
    assert.equal(messages[0].gif.token, undefined);
    const rejected = waitForSocketMessage(sockets[1], (message) => message.type === "reaction-error", "actor-bound token");
    sockets[1].send(JSON.stringify({ type: "reaction", kind: "gif", token: page.results[0].token }));
    assert.match((await rejected).message, /expired/);
    allowed = false;
    assert.equal((await fetch(endpoint, { headers: terminalUserOne })).status, 404);
    const revoked = waitForSocketMessage(sockets[0], (message) => message.type === "reaction-error", "revoked sender");
    sockets[0].send(JSON.stringify({ type: "reaction", emoji: "😀" }));
    assert.match((await revoked).message, /no longer have access/);
    assert.equal(unrelated.length, 0);
  } finally {
    for (const socket of sockets) socket.close();
    await app.close();
  }
});


test("provider runtime status and checks require the workspace token and validate revisions", async () => {
  const checked = [];
  const apiProviderRuntime = {
    status: () => ({ klipy: { available: true, configured: true, source: "settings", revision: 2 } }),
    gifProvider: () => ({ configured: false }),
    check: async (provider, revision) => { checked.push({ provider, revision }); return { revision, capabilities: [{ name: "GIF search", ok: true, message: "Connection works" }] }; },
  };
  const app = await fixture(true, { apiProviderRuntime });
  try {
    const base = `${app.origin}/internal/plugins/providers`;
    assert.equal((await fetch(`${base}/status`)).status, 401);
    const headers = { Authorization: "Bearer workspace-control-token-at-least-thirty-two-characters", "Content-Type": "application/json" };
    const status = await fetch(`${base}/status`, { headers });
    assert.equal(status.status, 200);
    assert.equal(status.headers.get("cache-control"), "no-store");
    assert.equal((await status.json()).providers.klipy.revision, 2);
    assert.equal((await fetch(`${base}/klipy/check`, { method: "POST", headers, body: JSON.stringify({ revision: "invalid" }) })).status, 503);
    assert.equal(checked.length, 0);
    const result = await fetch(`${base}/klipy/check`, { method: "POST", headers, body: JSON.stringify({ revision: 2 }) });
    assert.equal(result.status, 200);
    assert.deepEqual(checked, [{ provider: "klipy", revision: 2 }]);
  } finally { await app.close(); }
});
