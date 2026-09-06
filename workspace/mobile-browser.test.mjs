// Local, synthetic UI acceptance: npm --prefix workspace/desktop run dev -- --port 4196
// PLAYWRIGHT_MODULE_PATH=/absolute/path/to/playwright-core node --test workspace/mobile-browser.test.mjs
// Optional: BROWSER_ENGINE=firefox, MOBILE_TEST_ORIGIN, MOBILE_SCREENSHOT_DIR.
// No signed-in session, production terminal, or external gateway is used.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { tmpdir } from "node:os";

test(
  "Neura history and terminal controls work at mobile widths",
  {
    skip: !process.env.PLAYWRIGHT_MODULE_PATH,
    timeout: 90000,
  },
  async () => {
    const require = createRequire(import.meta.url);
    const engine = process.env.BROWSER_ENGINE || "chromium";
    const browser = await require(process.env.PLAYWRIGHT_MODULE_PATH)[
      engine
    ].launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const screenshot = (name) =>
      page.screenshot({
        path: path.join(
          process.env.MOBILE_SCREENSHOT_DIR || tmpdir(),
          `${name}-${engine}.png`,
        ),
      });
    const noOverflow = async () =>
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    const aboveDock = async (selector) =>
      assert.equal(
        await page
          .locator(selector)
          .evaluate(
            (element) =>
              element.getBoundingClientRect().bottom <=
              document.querySelector(".dock").getBoundingClientRect().top,
          ),
        true,
      );
    try {
      await page.goto(
        `${process.env.MOBILE_TEST_ORIGIN || "http://127.0.0.1:4196"}/workspace/tests/mobile.html`,
      );
      const historyButton = page.getByRole("button", {
        name: "Open conversation history",
      });
      await historyButton.waitFor();
      assert.ok((await historyButton.boundingBox()).height >= 44);
      await screenshot("neura-mobile");
      await historyButton.tap();
      const history = page.getByRole("dialog", {
        name: "Conversation history",
      });
      await history.waitFor();
      assert.equal(await page.locator(".neura-sidebar").count(), 1);
      await screenshot("neura-history-mobile");
      await history
        .getByPlaceholder("Search chats and channels")
        .fill("Planning conversation 30");
      await history
        .getByRole("button", { name: /^Planning conversation 30/ })
        .tap();
      await history.waitFor({ state: "detached" });
      await historyButton.tap();
      await history.getByPlaceholder("Search chats and channels").fill("");
      await history
        .getByRole("button", { name: "Archived", exact: true })
        .tap();
      await history
        .getByRole("button", { name: /^Planning conversation 34/ })
        .waitFor();
      const actions = history.getByLabel(
        "Actions for Planning conversation 34",
        { exact: true },
      );
      assert.equal(
        await actions.evaluate((element) => getComputedStyle(element).opacity),
        "1",
      );
      await actions.tap();
      await history
        .getByRole("button", { name: "Unarchive", exact: true })
        .scrollIntoViewIfNeeded();
      await screenshot("neura-history-actions-mobile");
      await page.keyboard.press("Escape");
      assert.equal(
        await historyButton.evaluate(
          (element) => element === document.activeElement,
        ),
        true,
      );
      const composer = page.getByPlaceholder("Message Neura…");
      await composer.fill("First line");
      await composer.press("Enter");
      assert.equal(await composer.inputValue(), "First line\n");
      assert.deepEqual(await page.evaluate(() => window.mobileQA.sends), []);
      await composer.fill(
        "A multiline draft\nSecond line\nThird line\nFourth line",
      );
      assert.ok((await composer.boundingBox()).height > 60);
      for (const size of [
        { width: 320, height: 568 },
        { width: 390, height: 420 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(150);
        await noOverflow();
        await aboveDock(".neura-composer-area");
      }
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .tap();
      assert.equal(
        (await page.evaluate(() => window.mobileQA.sends)).length,
        1,
      );
      await historyButton.tap();
      await history
        .getByRole("button", { name: /Release planning.*unread/ })
        .tap();
      await history.waitFor({ state: "detached" });
      await page.setViewportSize({ width: 320, height: 568 });
      await page.getByRole("button", { name: "Open channel terminals" }).tap();
      const channelTerminals = page.getByRole("dialog", {
        name: "Channel terminals",
        exact: true,
      });
      await channelTerminals
        .getByRole("button", {
          name: "Open terminal Release room",
          exact: true,
        })
        .waitFor();
      await screenshot("neura-channel-terminals-mobile");
      await channelTerminals
        .getByRole("button", { name: "Close channel terminals", exact: true })
        .tap();
      await noOverflow();
      await screenshot("neura-team-mobile");
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("navigation", { name: "QA applications" })
        .getByRole("button", { name: "Terminal", exact: true })
        .tap();
      const sessionsButton = page.getByRole("button", {
        name: "Open terminal sessions",
      });
      await sessionsButton.tap();
      const sessions = page.getByRole("dialog", {
        name: "Terminal sessions",
        exact: true,
      });
      await sessions.waitFor();
      await screenshot("terminal-sessions-mobile");
      await sessions
        .getByPlaceholder("Search terminal names")
        .fill("Workspace");
      await sessions
        .getByRole("button", { name: /Workspace shell.*Private/ })
        .tap();
      await sessions.waitFor({ state: "detached" });
      const touch = page.getByRole("toolbar", {
        name: "Touch keys for Workspace shell",
      });
      await page.waitForFunction(
        () => !document.querySelector('[aria-label="Escape"]').disabled,
      );
      assert.equal(
        await page.evaluate(() =>
          document.activeElement.classList.contains("xterm-helper-textarea"),
        ),
        false,
      );
      await touch
        .getByRole("button", { name: "Tab completion", exact: true })
        .tap();
      await touch
        .getByRole("button", { name: "Previous command", exact: true })
        .tap();
      await touch
        .getByRole("button", { name: "Interrupt command", exact: true })
        .tap();
      assert.deepEqual(await page.evaluate(() => window.mobileQA.inputs), [
        "\t",
        "\x1b[A",
        "\x03",
      ]);
      await touch
        .getByRole("button", { name: "Show terminal keyboard", exact: true })
        .tap();
      assert.equal(
        await page.evaluate(() =>
          document.activeElement.classList.contains("xterm-helper-textarea"),
        ),
        true,
      );
      await touch
        .getByRole("button", { name: "Control next key", exact: true })
        .tap();
      await page.keyboard.type("d");
      assert.equal(
        (await page.evaluate(() => window.mobileQA.inputs)).at(-1),
        "\x04",
      );
      await screenshot("terminal-mobile");
      await sessionsButton.tap();
      await sessions.getByRole("button", { name: "Add split pane" }).tap();
      await page
        .getByRole("tab", { name: "New shell 12", exact: true })
        .waitFor();
      assert.equal(await page.locator(".terminal-pane").count(), 2);
      const connections = await page.evaluate(
        () => window.mobileQA.connections,
      );
      await page
        .getByRole("tab", { name: "Workspace shell", exact: true })
        .tap();
      await page.getByRole("tab", { name: "New shell 12", exact: true }).tap();
      assert.equal(
        await page.evaluate(() => window.mobileQA.connections),
        connections,
      );
      assert.equal(await page.evaluate(() => window.mobileQA.disposals), 0);
      for (const size of [
        { width: 320, height: 568 },
        { width: 390, height: 420 },
        { width: 390, height: 844 },
        { width: 1100, height: 800 },
      ]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(150);
        await noOverflow();
        if (size.width <= 760) {
          assert.equal(await page.locator(".terminal-pane:visible").count(), 1);
          await aboveDock(".terminal-touch-keys:visible");
        } else
          assert.equal(await page.locator(".terminal-pane:visible").count(), 2);
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
