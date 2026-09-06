// Dev-only synthetic fixtures: no production accounts, provider keys, or SMS.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { tmpdir } from "node:os";
test("Settings cards, Security, and notification preferences fit desktop and phones", { skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 90000 }, async () => {
  const require = createRequire(import.meta.url);
  const browser = await require(process.env.PLAYWRIGHT_MODULE_PATH).chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[1280, 900], [1280, 420], [390, 420], [320, 568]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const errors = []; page.on("pageerror", (error) => errors.push(error.message));
      const shot = (name) => page.screenshot({ path: path.join(tmpdir(), `settings-${name}-${width}x${height}.png`) });
      const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector(".settings-scroll").scrollWidth <= document.querySelector(".settings-scroll").clientWidth), true);
      const navigate = async (name) => {
        const menu = page.getByRole("button", { name: "Open settings navigation" });
        if (await menu.isVisible()) await menu.click();
        await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
      };
      await page.goto(`${process.env.MOBILE_TEST_ORIGIN || "http://127.0.0.1:4198"}/workspace/tests/settings.html`);
      await page.getByRole("button", { name: "Set up KLIPY" }).waitFor();
      assert.equal(await page.locator(".provider-card").count(), 5);
      await noOverflow(); await shot("cards");
      await page.getByRole("button", { name: "Set up KLIPY" }).click();
      await page.getByLabel("API key").fill("placeholder-test-key");
      await page.getByRole("button", { name: "Save key" }).click();
      await page.getByText("Using the API key saved in Settings.").waitFor();
      assert.equal(await page.getByLabel("API key").inputValue(), "");
      await page.getByRole("button", { name: "Check connection" }).click();
      await page.getByText(/Connection works/).waitFor();
      await noOverflow(); await shot("provider");
      await navigate("Security");
      await page.getByRole("heading", { name: "Security", exact: true }).waitFor();
      await page.getByRole("button", { name: "Create passkey", exact: true }).waitFor();
      await page.getByRole("textbox", { name: "Phone number", exact: true }).fill("+12025550123");
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Send verification code" }).click();
      await page.getByRole("textbox", { name: "Six-digit verification code" }).fill("000123");
      await page.getByRole("button", { name: "Verify number", exact: true }).click();
      await page.getByText("Verified", { exact: true }).waitFor();
      assert.equal(await page.getByText("Agent SMS/MMS updates", { exact: true }).count(), 0);
      await noOverflow(); await shot("security");
      await navigate("Personalization");
      const toggle = page.getByRole("checkbox", { name: /Agent SMS/ });
      await toggle.click();
      await page.waitForFunction(() => document.querySelector(".phone-settings__notification-toggle input")?.checked === true);
      await page.getByText("Neura may now send you requested SMS/MMS updates.").waitFor();
      assert.equal(await page.getByRole("button", { name: "Create passkey" }).count(), 0);
      assert.equal(await page.getByRole("textbox", { name: "Phone number", exact: true }).count(), 0);
      await noOverflow(); await shot("notifications");
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
});
