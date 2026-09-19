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

test("Claude native login fits narrow Settings and sends input only to its attempt", { skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 60_000 }, async () => {
  const require = createRequire(import.meta.url);
  const browser = await require(process.env.PLAYWRIGHT_MODULE_PATH).chromium.launch({ headless: true });
  try {
    for (const width of [320, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      let phase = "disconnected", data = "";
      const status = () => ({ provider: "anthropic", authMethod: "subscription", state: phase, authenticated: phase === "connected", modelReady: phase === "connected", paused: phase !== "connected", agentId: "nl-test" });
      await page.route("**/api/**", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname.includes("/anthropic/connection")) {
          if (url.pathname.endsWith("/connect")) { phase = "awaiting_user"; return route.fulfill({ json: { ...status(), attemptId: "11111111-1111-4111-8111-111111111111" } }); }
          if (url.pathname.endsWith("/terminal-ticket")) {
            const body = request.postDataJSON();
            assert.equal(body.attemptId, "11111111-1111-4111-8111-111111111111");
            assert.equal(request.headers()["x-csrf-token"], "model-test-csrf");
            assert.equal(body.data, undefined);
            return route.fulfill({ json: { ticket: "example-ticket", path: "/workspace/api/claude-login/socket", protocol: "neural-claude-login.v1" } });
          }
          if (url.pathname.endsWith("/cancel")) phase = "disconnected";
          return route.fulfill({ json: status() });
        }
        if (url.pathname.startsWith("/api/account/openai")) return route.fulfill({ json: { provider: "openai", authMethod: "chatgpt", state: "disconnected", authenticated: false, modelReady: false, paused: true, agentId: "nl-test" } });
        return route.fulfill({ json: {} });
      });
      await page.routeWebSocket("**/workspace/api/claude-login/socket", socket => {
        socket.send(JSON.stringify({ type: "ready", data: "Paste code here if prompted:\r\n", verificationUrl: "https://claude.ai/oauth/authorize?code=true&state=test-only" }));
        socket.onMessage(raw => {
          const message = JSON.parse(String(raw));
          if (message.type === "input") data += message.data;
        });
      });
      await page.goto(`${process.env.DESKTOP_TEST_ORIGIN || "http://127.0.0.1:4196"}/workspace/tests/providers.html`);
      await page.getByRole("button", { name: "Configure Claude" }).click();
      await page.getByRole("button", { name: "Connect Claude", exact: true }).click();
      await page.getByRole("link", { name: "Open Anthropic sign-in" }).waitFor();
      const input = page.locator(".claude-login-terminal .xterm-helper-textarea");
      await input.pressSequentially("test-code"); await input.press("Enter");
      await page.waitForTimeout(1000);
      assert.ok(data.includes("test-code\r"));
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.evaluate(() => navigator.clipboard.writeText("clipboard-test-code"));
      await page.getByRole("button", { name: "Paste into terminal" }).click();
      await page.getByRole("button", { name: "Enter", exact: true }).click();
      await page.getByLabel("Sign-in code", { exact: true }).fill("form-test-code#state");
      await page.getByRole("button", { name: "Send code", exact: true }).click();
      await page.waitForTimeout(100);
      assert.ok(data.includes("clipboard-test-code\r"));
      assert.ok(data.includes("form-test-code#state\r"));
      assert.equal(await page.getByLabel("Sign-in code", { exact: true }).inputValue(), "");
      const card = await page.locator(".claude-provider-card").boundingBox();
      assert.ok(card && card.x >= 0 && card.x + card.width <= width, "Claude card must fit rather than be clipped by the app window");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `/tmp/neural-labs-claude-login-${width}.png` });
      await page.getByRole("button", { name: "Cancel sign-in" }).click();
      await page.getByRole("button", { name: "Connect Claude", exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
