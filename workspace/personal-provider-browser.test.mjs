// Synthetic UI regression: no real accounts or provider requests.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

test("personal Connect button sends a request and displays the device code", { skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 60_000 }, async () => {
  const require = createRequire(import.meta.url);
  const browser = await require(process.env.PLAYWRIGHT_MODULE_PATH)[process.env.BROWSER_ENGINE || "chromium"].launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
  try {
    for (const width of [390, 820, 1280]) {
      for (const { desktop, setup } of [{ desktop: false, setup: true }, { desktop: true, setup: true }, { desktop: true, setup: false }]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        page.setDefaultTimeout(8000);
        let started = false;
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.route("**/api/**", async route => {
          const req = route.request();
          const url = new URL(req.url());
          if (url.pathname === "/api/account/openai/connect") {
            assert.equal(req.method(), "POST");
            started = true;
            return route.fulfill({ json: { state: "starting", authenticated: false, modelReady: false, paused: false } });
          }
          return route.fulfill({ json: { state: started ? "awaiting_user" : "disconnected", authenticated: false, modelReady: false, paused: true, verificationUrl: started ? "https://auth.openai.com/codex/device" : null, userCode: started ? "TEST-CODE" : null } });
        });
        await page.goto(`${process.env.DESKTOP_TEST_ORIGIN || "http://127.0.0.1:4196"}/workspace/tests/${desktop ? "desktop.html?provider=1" : "providers.html"}`);
        if (desktop) {
          await page.getByRole("button", { name: "Settings", exact: true }).click();
          await page.getByRole("region", { name: "Settings application" }).locator(".settings-app").waitFor();
          if (width > 760) {
            await page.getByRole("button", { name: "Maximize Settings", exact: true }).click({ button: "right" });
            await page.getByRole("menuitem", { name: "Snap left", exact: true }).click();
            await page.getByRole("button", { name: "Open settings navigation" }).waitFor();
          }
          const menu = page.getByRole("button", { name: "Open settings navigation" });
          if (await menu.isVisible()) await menu.click();
          await page.getByRole("button", { name: /^Model Provider/ }).click();
        }
        await page.getByRole("button", { name: setup ? "Set up OpenAI" : "Configure OpenAI" }).click();
        assert.equal(await page.getByRole("button", { name: "Refresh connection", exact: true }).count(), 0);
        await page.getByRole("button", { name: "Connect ChatGPT", exact: true }).click({ timeout: 8000 });
        await page.getByText("TEST-CODE", { exact: true }).waitFor({ timeout: 8000 });
        const link = page.getByRole("link", { name: "Open OpenAI sign-in" });
        await link.scrollIntoViewIfNeeded();
        const colors = await link.evaluate(el => ({ foreground: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
        const rgb = value => value.match(/[\d.]+/g).map(Number);
        const foreground = rgb(colors.foreground), background = rgb(colors.background);
        assert.equal(background[3] ?? 1, 1, "The sign-in link needs a visible button background");
        const luminance = channels => channels.slice(0, 3).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
        const levels = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
        assert.ok((levels[0] + .05) / (levels[1] + .05) >= 4.5, "Sign-in link text must have readable contrast");
        const linkBox = await link.boundingBox();
        const panelBox = await page.locator(".settings-scroll").boundingBox();
        assert.ok(linkBox && panelBox && linkBox.x >= panelBox.x && linkBox.x + linkBox.width <= panelBox.x + panelBox.width, "Sign-in link must fit inside the settings window");
        assert.equal(await page.locator(".settings-scroll").evaluate(el => el.scrollWidth <= el.clientWidth), true, "Device code and link must not overflow the settings window");
        await page.getByText("2. Enter this one-time code on the OpenAI page.", { exact: true }).waitFor();
        assert.equal(await link.getAttribute("href"), "https://auth.openai.com/codex/device");
        assert.equal(await link.getAttribute("target"), "_blank");
        if (desktop && width === 820 && setup) await page.screenshot({ path: `/tmp/personal-signin-${process.env.BROWSER_ENGINE || "chromium"}.png` });
        if (!desktop) assert.equal(started, true);
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
  } finally { await browser.close(); }
});
