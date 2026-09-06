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
      await page.getByRole("heading", { name: "Claude is coming soon" }).waitFor();
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
