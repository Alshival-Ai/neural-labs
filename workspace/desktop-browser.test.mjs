import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const origin = process.env.DESKTOP_TEST_ORIGIN || "http://127.0.0.1:4199";
test("desktop app bar, full-height snaps, restore, persistence and touch layouts", { skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 90000 }, async () => {
  const require = createRequire(import.meta.url);
  const browser = await require(process.env.PLAYWRIGHT_MODULE_PATH).chromium.launch({ headless: true });
  try {
    for (const [width, height, touch] of [[1280, 900, false], [1280, 420, false], [820, 900, true], [390, 420, true], [320, 568, true]]) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = []; page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${origin}/workspace/tests/desktop.html`);
      await page.locator('#desktop-canvas[aria-busy="false"]').waitFor({ state: "attached" });
      page.setDefaultTimeout(10000);
      const opacity = (selector) => page.locator(selector).evaluate((element) => getComputedStyle(element).opacity);
      await page.mouse.move(width / 2, height / 2);
      assert.equal(await page.locator(".topbar, .shell-reveal-zone--top").count(), 0);
      await page.mouse.move(width / 2, 2);
      assert.equal(await page.locator(".topbar").count(), 0);
      await page.getByRole("button", { name: "Neura", exact: true }).click();
      const neura = page.getByRole("region", { name: "Neura application" });
      await neura.waitFor();
      if (width > 760) {
        const layout = async (window, label) => {
          await window.locator(".window-maximize").focus();
          await page.keyboard.press("ArrowDown");
          await window.getByRole("menuitem", { name: label, exact: true }).click();
          await window.locator(`xpath=self::*[@data-placement="${({ "Snap left": "left", "Snap right": "right", Maximize: "maximized", Restore: "freeform" })[label]}"]`).waitFor();
          await window.evaluate((element) => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        };
        const original = await neura.boundingBox();
        await layout(neura, "Snap left");
        let rect = await neura.boundingBox();
        assert.equal(rect.x, 0); assert.equal(rect.width, width / 2); assert.equal(rect.y + rect.height, height);
        assert.equal(rect.y, 0);
        await page.mouse.move(width / 2, height / 2);
        assert.equal(await opacity(".dock"), "0");
        if (touch) await page.getByRole("button", { name: "Show dock", exact: true }).tap();
        else await page.mouse.move(width / 2, height - 2);
        await page.waitForFunction(() => getComputedStyle(document.querySelector(".dock")).opacity === "1");
        await page.getByRole("button", { name: "Terminal", exact: true }).click();
        const terminal = page.getByRole("region", { name: "Terminal application" });
        await terminal.getByRole("button", { name: /^Personal terminal/ }).click();
        await terminal.locator(".xterm-screen").waitFor();
        await layout(terminal, "Snap right");
        rect = await terminal.boundingBox(); assert.equal(rect.x, width / 2); assert.equal(rect.y + rect.height, height);
        await page.screenshot({ path: `/tmp/desktop-snapped-${width}x${height}.png` });
        await terminal.getByRole("button", { name: "Maximize Terminal", exact: true }).click();
        await terminal.getByRole("button", { name: "Restore Terminal", exact: true }).click();
        assert.equal(await terminal.getAttribute("data-placement"), "right");
        if (!touch) {
          const popupReady = page.waitForEvent("popup");
          await terminal.getByRole("button", { name: "Pop out Terminal", exact: true }).click();
          const popup = await popupReady;
          await popup.getByRole("button", { name: "Pop Terminal back into desktop", exact: true }).click();
          await terminal.waitFor();
          assert.equal(await terminal.getAttribute("data-placement"), "right");
        }
        await page.reload();
        await terminal.waitFor();
        assert.equal(await terminal.getAttribute("data-placement"), "right");
        await layout(terminal, "Restore");
        if (!touch) {
          // Capture continues through an iframe, and Escape restores the original rectangle.
          await terminal.locator(".window-content").evaluate((element) => { const frame = document.createElement("iframe"); frame.srcdoc = "<button>Embedded app</button>"; frame.style.cssText = "position:absolute;inset:40px 0 0;width:100%;height:80%;z-index:100"; element.append(frame); });
          let box = await terminal.boundingBox();
          await page.mouse.move(box.x + 100, box.y + 22); await page.mouse.down();
          await page.mouse.move(10, 130, { steps: 10 });
          await page.locator('[data-snap-target="left"]').waitFor();
          assert.equal(await page.locator(".topbar").count(), 0);
          await page.keyboard.press("Escape"); await page.mouse.up();
          assert.deepEqual(await terminal.boundingBox(), box);
          await page.mouse.move(box.x + 100, box.y + 22); await page.mouse.down();
          await page.mouse.move(width - 2, 130, { steps: 10 }); await page.mouse.up();
          assert.equal(await terminal.getAttribute("data-placement"), "right");
          await page.setViewportSize({ width: 390, height: 568 });
          await page.setViewportSize({ width, height });
          assert.equal(await terminal.getAttribute("data-placement"), "right");
          box = await terminal.boundingBox();
          await page.mouse.move(box.x + 100, box.y + 22); await page.mouse.down();
          await page.mouse.move(width / 2, 2, { steps: 10 });
          await page.locator('[data-snap-target="maximized"]').waitFor();
          await page.mouse.up();
          assert.equal(await terminal.getAttribute("data-placement"), "maximized");
          await layout(neura, "Restore");
          const restored = await neura.boundingBox(); assert.equal(restored.width, original.width);
        }
      } else {
        assert.equal(await neura.locator(".window-maximize").isVisible(), false);
        const rect = await neura.boundingBox();
        assert.equal(rect.y, 0);
        assert.equal(rect.height, height);
        assert.equal(await opacity(".dock"), "1");
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
});

test("app bar provides Settings and sign out after maximizing, without taking window space", { skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 30000 }, async () => {
  const require = createRequire(import.meta.url);
  const browser = await require(process.env.PLAYWRIGHT_MODULE_PATH).chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(5000);
    await page.goto(`${origin}/workspace/tests/desktop.html`);
    await page.locator('#desktop-canvas[aria-busy="false"]').waitFor({ state: "attached" });
    await page.getByRole("button", { name: "Neura", exact: true }).click();
    const region = page.getByRole("region", { name: "Neura application" });
    await region.getByRole("button", { name: "Maximize Neura", exact: true }).click();
    await page.mouse.move(640, 2);
    assert.equal(await page.locator(".topbar, .shell-reveal-zone--top").count(), 0);
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".dock")).opacity === "0");
    const rectangle = await region.boundingBox();
    assert.deepEqual(rectangle, { x: 0, y: 0, width: 1280, height: 800 });
    await page.mouse.move(640, 798);
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".dock")).opacity === "1");
    assert.deepEqual(await region.boundingBox(), rectangle);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("region", { name: "Settings application" });
    await settings.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await settings.getByText("ready", { exact: true }).waitFor();
    await page.screenshot({ path: "/tmp/desktop-settings-without-topbar.png" });
  } finally { await browser.close(); }
});
