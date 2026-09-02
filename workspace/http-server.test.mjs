import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
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

async function fixture(ready = true, { maxUploadBytes, maxTextBytes, mcpReady = true, runTeamAgent } = {}) {
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
  const server = createWorkspaceHttpServer({
    desktopRoot,
    workspaceRoot,
    publicOrigin: "https://neural-labs.example.com",
    gatewayReady: async () => ready,
    mcpStatus: async () => mcpStatusFixture(mcpReady),
    providerAuthenticated: () => false,
    openclawModelReady: () => false,
    providerAuth: {
      snapshot: () => ({ provider: "openai", state: "disconnected" }),
      start: () => ({ provider: "openai", state: "starting" }),
      cancel: () => ({ provider: "openai", state: "disconnected" }),
    },
    workspaceControlToken: "workspace-control-token-at-least-thirty-two-characters",
    openclawVersion: "2026.8.2",
    codexVersion: "0.152.0",
    maxUploadBytes,
    maxTextBytes,
    runTeamAgent,
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
    }]);
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
  const previewRoot = Buffer.from("projects/site").toString("base64url");
  const previewBase = `${app.origin}/workspace/preview/${previewRoot}`;
  try {
    assert.equal((await fetch(`${previewBase}/`)).status, 401);

    const page = await fetch(`${previewBase}/`, { headers: workspaceHeaders });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /^text\/html/);
    assert.equal(page.headers.get("access-control-allow-origin"), "*");
    assert.equal(page.headers.get("cache-control"), "private, no-store");
    assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.equal(page.headers.get("x-frame-options"), null);
    const policy = page.headers.get("content-security-policy");
    assert.match(policy, /sandbox allow-scripts/);
    assert.match(policy, /connect-src 'none'/);
    assert.match(policy, /frame-ancestors 'self'/);
    assert.match(await page.text(), /Preview works/);

    const stylesheet = await fetch(`${previewBase}/styles.css`, { headers: workspaceHeaders });
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("content-type"), /^text\/css/);
    assert.equal(await stylesheet.text(), "button { color: rebeccapurple; }\n");

    await writeFile(path.join(app.workspaceRoot, "index.html"), "<!doctype html><h1>Root preview works</h1>");
    const rootPage = await fetch(`${app.origin}/workspace/preview/root/index.html`, { headers: workspaceHeaders });
    assert.equal(rootPage.status, 200);
    assert.match(await rootPage.text(), /Root preview works/);

    const head = await fetch(`${previewBase}/index.html`, { method: "HEAD", headers: workspaceHeaders });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal((await fetch(`${previewBase}/index.html`, { method: "POST", headers: workspaceHeaders })).status, 405);

    const fileRoot = Buffer.from("notes.md").toString("base64url");
    const invalidRoot = await fetch(`${app.origin}/workspace/preview/${fileRoot}/index.html`, { headers: workspaceHeaders });
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
      mcpReady: true,
      mcp: mcpStatusFixture(true),
      openclawVersion: "2026.8.2",
      codexVersion: "0.152.0",
      providerAuthenticated: false,
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
      mcpReady: false,
      mcp: mcpStatusFixture(false),
      openclawVersion: "2026.8.2",
      codexVersion: "0.152.0",
      providerAuthenticated: false,
      codexAuthenticated: false,
      openclawModelReady: false,
    });
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

test("shares one Team PTY while participants take turns controlling it", async () => {
  const app = await fixture();
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
    assert.equal(owner.ready.connectionId, owner.ready.session.controller.connectionId);

    const ownerSeesOutput = waitForSocketMessage(ownerSocket, (message) => message.type === "output" && message.data.includes("NL_TEAM_OWNER"), "owner sees shared output");
    const teammateSeesOutput = waitForSocketMessage(teammateSocket, (message) => message.type === "output" && message.data.includes("NL_TEAM_OWNER"), "teammate sees the driver's output");
    ownerSocket.send(JSON.stringify({ type: "input", data: "printf 'NL_TEAM_OWNER\\n'\n" }));
    await Promise.all([ownerSeesOutput, teammateSeesOutput]);

    const ownerHandoff = waitForSocketMessage(ownerSocket, (message) => message.type === "presence" && message.controller?.connectionId === teammate.ready.connectionId, "owner sees control handoff");
    const teammateHandoff = waitForSocketMessage(teammateSocket, (message) => message.type === "presence" && message.controller?.connectionId === teammate.ready.connectionId, "teammate takes control");
    teammateSocket.send(JSON.stringify({ type: "claim-control" }));
    await Promise.all([ownerHandoff, teammateHandoff]);

    const ownerSeesTeammateOutput = waitForSocketMessage(ownerSocket, (message) => message.type === "output" && message.data.includes("NL_TEAM_TEAMMATE"), "owner sees new driver's output");
    const teammateSeesOwnOutput = waitForSocketMessage(teammateSocket, (message) => message.type === "output" && message.data.includes("NL_TEAM_TEAMMATE"), "new driver sees output");
    teammateSocket.send(JSON.stringify({ type: "input", data: "printf 'NL_TEAM_TEAMMATE\\n'\n" }));
    await Promise.all([ownerSeesTeammateOutput, teammateSeesOwnOutput]);

    const resized = waitForSocketMessage(ownerSocket, (message) => message.type === "layout" && message.cols === 132 && message.rows === 42, "new leader resizes PTY");
    teammateSocket.send(JSON.stringify({ type: "resize", cols: 132, rows: 42 }));
    await resized;

    const ownerReaction = waitForSocketMessage(ownerSocket, (message) => message.type === "reaction" && message.emoji === "🚀", "owner sees teammate reaction");
    const teammateReaction = waitForSocketMessage(teammateSocket, (message) => message.type === "reaction" && message.emoji === "🚀", "teammate sees own reaction");
    teammateSocket.send(JSON.stringify({ type: "reaction", emoji: "🚀" }));
    await Promise.all([ownerReaction, teammateReaction]);

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
