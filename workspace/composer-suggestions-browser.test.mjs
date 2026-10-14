import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const origin = process.env.DESKTOP_TEST_ORIGIN || "http://127.0.0.1:4199";
test("skill and people suggestions escape compact composer clipping and remain clickable", {
  skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 90000,
}, async () => {
  const browser = await createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH).chromium.launch({ headless: true });
  try {
    for (const width of [1280, 640, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${origin}/workspace/tests/mobile.html`);
      const composer = page.getByPlaceholder("Message Alshival…");
      await composer.fill("$");
      const menu = page.getByRole("listbox", { name: "Available skills", exact: true });
      const option = menu.getByRole("option", { name: /Website builder/ });
      await option.waitFor();
      assert.equal(await option.evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), true, `Skill must be visible above the scrolling composer at ${width}px`);
      await option.click();
      assert.equal(await composer.inputValue(), "$website-builder ");
      await composer.fill("$");
      await page.setViewportSize({ width: Math.min(width, 640), height: 568 });
      await option.click();
      assert.equal(await composer.inputValue(), "$website-builder ");
      await composer.fill("$");
      await composer.press("Enter");
      assert.equal(await composer.inputValue(), "$website-builder ");
      await page.getByRole("button", { name: "Open conversation history" }).click();
      await page.getByRole("button", { name: /Release planning/ }).click();
      const teamComposer = page.getByRole("combobox");
      await teamComposer.fill("$");
      await page.getByRole("listbox", { name: "Available Team Chat skills" }).getByRole("option", { name: /Website builder/ }).click();
      assert.equal(await teamComposer.inputValue(), "$website-builder ");
      await teamComposer.fill("@Sal");
      await page.getByRole("listbox", { name: "Team Chat mentions" }).getByRole("option", { name: /Salvador/ }).click();
      assert.match(await teamComposer.inputValue(), /@salvador/);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
