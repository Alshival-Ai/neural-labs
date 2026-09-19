import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

test("model provider settings and conversation picker at mobile and desktop widths", { skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 60_000 }, async () => {
  const require = createRequire(import.meta.url);
  const browser = await require(process.env.PLAYWRIGHT_MODULE_PATH)[process.env.BROWSER_ENGINE || "chromium"].launch({ headless: true });
  try {
    for (const width of [320, 390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let policy = { provider: "openai", mode: "latest", model: "", effort: "" };
      let revision = 0;
      let authenticated = true;
      const model = { id: "openai/gpt-6-astra", provider: "openai", name: "GPT-6 Astra", available: true, supportsTools: true, efforts: [{ id: "high", label: "High" }, { id: "xhigh", label: "Extra high" }], defaultEffort: "high", input: ["text"] };
      await page.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname.endsWith("/catalog")) return route.fulfill({ json: { agentId: "nl-test", models: [model], runtime: { name: "Codex", version: "0.152.0" }, fetchedAt: "2026-09-05T00:00:00Z", stale: false } });
        if (url.pathname.endsWith("/defaults")) {
          if (request.method() === "PUT") { const body = request.postDataJSON(); assert.equal(request.headers()["x-csrf-token"], "model-test-csrf"); assert.equal(body.revision, revision); policy = body.policy; revision++; }
          return route.fulfill({ json: { policy, revision, pending: false, error: null, resolved: { model: model.id, effort: "high" } } });
        }
        if (url.pathname === "/api/account/openai/disconnect") { assert.equal(request.headers()["x-csrf-token"], "model-test-csrf"); authenticated = false; }
        if (url.pathname.startsWith("/api/account/openai")) return route.fulfill({ json: { provider: "openai", authMethod: "chatgpt", authenticated, modelReady: authenticated, state: authenticated ? "connected" : "disconnected", paused: !authenticated, agentId: "nl-test", verificationUrl: null, userCode: null, expiresAt: null, message: null } });
        return route.fulfill({ json: {} });
      });
      const url = `${process.env.DESKTOP_TEST_ORIGIN || "http://127.0.0.1:4196"}/workspace/tests/providers.html`;
      await page.goto(url);
      await page.getByRole("heading", { name: "Model Provider", exact: true }).waitFor();
      const heading = await page.getByRole("heading", { name: "Model Provider", exact: true }).boundingBox();
      assert.ok(heading && heading.x >= 0 && heading.x + heading.width <= width, "Settings content must fit inside its app window, not merely be clipped");
      await page.getByRole("combobox", { name: "Default provider" }).waitFor();
      await page.getByRole("combobox", { name: "Model", exact: true }).selectOption(model.id);
      await page.getByRole("combobox", { name: "Reasoning" }).selectOption("xhigh");
      await page.getByRole("button", { name: "Refresh connection" }).click();
      await page.getByText("Connection and models refreshed. Your defaults are unchanged.").waitFor();
      assert.equal(await page.getByRole("combobox", { name: "Reasoning" }).inputValue(), "xhigh");
      assert.equal(revision, 0, "Refreshing must not save default policies");
      await page.getByRole("button", { name: "Save defaults", exact: true }).click();
      await page.getByText("Defaults saved for new, unpinned turns.").waitFor();
      assert.equal(policy.effort, "xhigh");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: `/tmp/neural-labs-model-providers-${process.env.BROWSER_ENGINE || "chromium"}-${width}.png` });
      const configure = page.getByRole("button", { name: "Configure OpenAI" });
      await configure.focus(); await page.keyboard.press("Enter");
      await page.getByRole("heading", { name: "Your ChatGPT account" }).waitFor();
      await page.getByRole("button", { name: "Back to providers" }).click();
      await page.getByRole("button", { name: "Disconnect", exact: true }).click();
      await page.getByRole("button", { name: "Keep connected" }).click();
      assert.equal(authenticated, true);
      await page.getByRole("button", { name: "Disconnect", exact: true }).click();
      await page.getByRole("button", { name: "Confirm disconnect" }).click();
      await page.getByRole("button", { name: "Set up OpenAI" }).waitFor();
      assert.equal(await page.getByRole("combobox", { name: "Default provider" }).count(), 0);
      await page.getByRole("button", { name: "Configure Claude" }).click();
      await page.getByRole("heading", { name: "Your Claude account" }).waitFor();
      await page.getByRole("button", { name: "Back to providers" }).click();
      await page.screenshot({ path: `/tmp/neural-labs-provider-cards-empty-${process.env.BROWSER_ENGINE || "chromium"}-${width}.png` });
      await page.goto(`${url}?conversation=1`);
      await page.locator("summary").click();
      await page.getByRole("combobox", { name: "Model", exact: true }).selectOption(model.id);
      await page.getByRole("button", { name: "Apply to conversation" }).click();
      await page.getByText("Saved for subsequent turns.", { exact: false }).waitFor();
      const box = await page.locator(".conversation-model-picker > div").boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("Claude sign-in opens the actual desktop Terminal app and pastes through its WebSocket", { skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 60_000 }, async () => {
  const require = createRequire(import.meta.url);
  const browser = await require(process.env.PLAYWRIGHT_MODULE_PATH).chromium.launch({ headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      let phase = "disconnected", data = "", terminalRequests = 0;
      const terminal = { id: "22222222-2222-4222-8222-222222222222", title: "Claude sign-in", scope: "personal", shell: "claude", cwd: "/workspace", status: "running", createdAt: Date.now(), lastActivityAt: Date.now(), cols: 90, rows: 24, sequence: 1, exitCode: null, owner: { label: "QA" }, owned: true, canTerminate: true, participants: [], voiceParticipants: [], layoutLeader: null, agentMode: "status-only", canControlAgent: false, providerSignIn: { provider: "anthropic", verificationUrl: "https://claude.ai/oauth/authorize?state=example" } };
      const status = () => ({ provider: "anthropic", authMethod: "subscription", state: phase, authenticated: false, modelReady: false, paused: true, agentId: "nl-test", message: null });
      await page.route("**/api/**", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === "/api/session") return route.fulfill({ json: { authenticated: true, csrfToken: "test-csrf", providers: ["local"], user: { id: "qa", handle: "qa", email: "qa@example.org", displayName: "QA", role: "user", status: "active" } } });
        if (url.pathname === "/api/workspace") return route.fulfill({ json: { status: "ready" } });
        if (url.pathname.includes("/anthropic/connection")) {
          assert.equal(request.postData()?.includes("example-pasted-code") ?? false, false);
          if (url.pathname.endsWith("/connect")) {
            assert.equal(request.headers()["x-csrf-token"], "test-csrf");
            phase = "awaiting_user";
            return route.fulfill({ json: { ...status(), attemptId: "11111111-1111-4111-8111-111111111111", terminalId: terminal.id } });
          }
          if (url.pathname.endsWith("/cancel")) phase = "disconnected";
          return route.fulfill({ json: status() });
        }
        if (url.pathname === "/workspace/api/terminals") {
          assert.equal(request.method(), "GET", "Launching sign-in must not create a generic shell");
          return route.fulfill({ json: { sessions: phase === "awaiting_user" ? [terminal] : [] } });
        }
        if (url.pathname === `/workspace/api/terminals/${terminal.id}`) { terminalRequests++; return route.fulfill({ json: { session: terminal } }); }
        if (url.pathname.endsWith(`/${terminal.id}/ticket`)) return route.fulfill({ json: { ticket: "example-ticket", path: "/workspace/api/terminals/socket", protocol: "neural-terminal.v1" } });
        if (url.pathname === "/api/account/model-providers/access" || url.pathname.startsWith("/api/account/openai")) return route.fulfill({ json: { provider: "openai", authMethod: "chatgpt", state: "disconnected", authenticated: false, modelReady: false, paused: true, agentId: "nl-test" } });
        return route.fulfill({ json: {} });
      });
      await page.routeWebSocket("**/workspace/api/terminals/socket", socket => {
        socket.send(JSON.stringify({ type: "ready", mode: "replay", connectionId: "connection", viewer: { id: "qa", label: "QA" }, session: terminal }));
        socket.send(JSON.stringify({ type: "replay", sequence: 1, data: "Paste code here if prompted:\r\n" }));
        socket.onMessage(raw => { const message = JSON.parse(String(raw)); if (message.type === "input") data += message.data; });
      });
      await page.goto(`${process.env.DESKTOP_TEST_ORIGIN || "http://127.0.0.1:4196"}/workspace/`);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const settings = page.locator(".settings-app");
      if (width < 600) await settings.getByRole("button", { name: /Open settings navigation/i }).click();
      await settings.getByRole("button", { name: "Model Provider", exact: true }).click();
      await page.getByRole("button", { name: "Configure Claude" }).click();
      await page.getByRole("button", { name: "Connect Claude", exact: true }).click();
      await page.getByRole("link", { name: "Open Anthropic sign-in" }).waitFor();
      await page.getByLabel("Claude sign-in interactive terminal").waitFor();
      assert.equal(terminalRequests, 1);
      assert.equal(await page.locator(".claude-login-terminal").count(), 0);
      assert.equal(await page.getByRole("button", { name: "Enable Neura", exact: true }).count(), 0);
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.evaluate(() => navigator.clipboard.writeText("example-pasted-code"));
      await page.getByRole("button", { name: "Paste into Claude sign-in", exact: true }).click();
      for (let attempt = 0; attempt < 100 && !data.includes("example-pasted-code"); attempt++) await page.waitForTimeout(20);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(150);
      assert.ok(data.includes("example-pasted-code\r"), `Terminal clipboard paste must reach the existing socket: ${JSON.stringify(data)}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `/tmp/neural-labs-claude-terminal-app-${width}.png` });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
