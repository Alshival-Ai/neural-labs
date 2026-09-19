// Synthetic sessions only. Run Vite on 4196 and set PLAYWRIGHT_MODULE_PATH.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("terminal creation and session menus work at desktop and touch widths", {
  skip: !process.env.PLAYWRIGHT_MODULE_PATH,
  timeout: 60000,
}, async () => {
  const require = createRequire(import.meta.url);
  const browser = await require(process.env.PLAYWRIGHT_MODULE_PATH).chromium.launch({ headless: true });
  try {
    for (const width of [390, 760, 1100, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 950 }, hasTouch: width <= 760 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${process.env.MOBILE_TEST_ORIGIN || "http://127.0.0.1:4196"}/workspace/tests/mobile.html`);
      await page.getByRole("button", { name: "Terminal", exact: true }).click();
      await page.getByRole("heading", { name: "New Terminal" }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await page.locator(".terminal-launchpad").evaluate((element) => element.scrollWidth <= element.clientWidth));
      await page.screenshot({ path: join(tmpdir(), `terminal-hub-${width}.png`) });

      const mobile = width <= 760;
      const newButton = page.getByRole("button", { name: mobile ? "New terminal" : "Create terminal", exact: true });
      await newButton.click();
      await page.getByRole("menuitem", { name: /^Team/ }).click();
      const name = page.getByRole("textbox", { name: "Team terminal name" });
      assert.equal(await name.evaluate((element) => element === document.activeElement), true);
      await name.fill("Pairing room");
      await page.getByRole("button", { name: "Start Team", exact: true }).click();
      await page.getByLabel("Pairing room interactive terminal").waitFor();

      const openActions = async (title) => {
        if (mobile) {
          const drawer = page.getByRole("dialog", { name: "Terminal sessions", exact: true });
          if (!await drawer.isVisible()) await page.getByRole("button", { name: "Open terminal sessions", exact: true }).click();
          await drawer.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
        } else {
          await page.getByRole("button", { name: `Open team session ${title}`, exact: true }).click({ button: "right" });
        }
        await page.getByRole("menu").waitFor();
        const box = await page.getByRole("menu").boundingBox();
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 950);
      };
      // Inactive actions never switch to the clicked session.
      await openActions("Release room");
      await page.screenshot({ path: join(tmpdir(), `terminal-actions-${width}.png`) });
      await page.keyboard.press("Escape");
      if (mobile) await page.getByRole("button", { name: "Close terminal sessions", exact: true }).click();
      await page.getByLabel("Pairing room interactive terminal").waitFor();

      await openActions("Pairing room");
      page.once("dialog", (dialog) => dialog.dismiss());
      await page.getByRole("menuitem", { name: /^End for everyone/ }).click();
      await openActions("Pairing room");
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("menuitem", { name: /^End for everyone/ }).click();
      await page.getByRole("button", { name: mobile ? "Actions for Pairing room" : "Open team session Pairing room", exact: true }).waitFor({ state: "detached" });
      if (mobile) await page.getByRole("button", { name: "Close terminal sessions", exact: true }).click();

      await newButton.click();
      await page.getByRole("menuitem", { name: /^Personal/ }).click();
      await page.getByLabel("New shell 13 interactive terminal").waitFor();
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
