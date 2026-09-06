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
      const mode = page.getByRole("combobox", { name: "Conversation mode" });
      await mode.selectOption("plan");
      assert.equal(await mode.inputValue(), "plan");
      await screenshot("neura-plan-mode-mobile");
      await mode.selectOption("default");
      await composer.fill("First line");
      await composer.press("Shift+Enter");
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
        await screenshot(`neura-composer-${size.width}x${size.height}`);
        await aboveDock(".neura-composer-area");
      }
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .tap();
      assert.equal(
        (await page.evaluate(() => window.mobileQA.sends)).length,
        1,
      );
      const activeComposer = page.getByPlaceholder("Steer Neura now, or queue what comes next…");
      await activeComposer.fill("A queued follow-up");
      await page.getByRole("button", { name: "Queue after this run" }).waitFor();
      await screenshot("neura-send-controls-mobile");
      await noOverflow();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByRole("button", { name: "Queue after this run" }).waitFor();
      await screenshot("neura-send-controls-desktop");
      await noOverflow();
      await page.setViewportSize({ width: 390, height: 844 });
      await activeComposer.press("Control+Enter");
      await page.getByRole("region", { name: "Queued messages" }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.mobileQA.queueModes), ["steer", "followup"]);
      assert.equal(await mode.isDisabled(), true);
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

test("chat sidebar, image preview, and download menus fit desktop and short phones", { skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 90000 }, async () => {
  const require = createRequire(import.meta.url);
  const browser = await require(process.env.PLAYWRIGHT_MODULE_PATH).chromium.launch({ headless: true });
  const picture = '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200"><rect width="360" height="200" fill="#dcecfb"/><circle cx="180" cy="90" r="55" fill="#3965bd"/><text x="180" y="175" text-anchor="middle" font-size="18">Chat attachment preview</text></svg>';
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 1280, height: 420 }, { width: 390, height: 420 }, { width: 320, height: 568 }]) {
      const context = await browser.newContext({ viewport, acceptDownloads: true });
      const page = await context.newPage();
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.route("**/workspace/api/files**", async route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/content") || url.pathname.endsWith("/download")) return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: url.pathname.endsWith("/download") ? { "Content-Disposition": 'attachment; filename="chat-preview.svg"' } : {}, body: picture });
        if (url.pathname.endsWith("/operations")) return route.fulfill({ json: { id: "qa-copy", state: "finished", results: [{ status: "completed", destination: "Downloads/chat-preview.svg" }] } });
        return route.fulfill({ json: { path: "Downloads", parent: "", entries: [] } });
      });
      await page.goto(`${process.env.MOBILE_TEST_ORIGIN || "http://127.0.0.1:4196"}/workspace/tests/mobile.html`);
      await page.getByPlaceholder("Message Neura…").waitFor();
      if (viewport.width < 700) await page.getByRole("button", { name: "Open conversation history" }).click();
      const section = page.locator(".private-chat-section");
      assert.equal(await section.locator(".history-row").count(), 5);
      await page.getByRole("button", { name: "Load more chats" }).click();
      assert.equal(await section.locator(".history-row").count(), 10);
      const teamHeading = page.locator(".team-chat-section > h2");
      const teamBounds = await teamHeading.boundingBox();
      const historyBounds = await page.locator(".history-list").boundingBox();
      assert.ok(teamBounds.y + teamBounds.height <= historyBounds.y + historyBounds.height);
      await page.screenshot({ path: path.join(tmpdir(), `neura-chat-sidebar-${viewport.width}x${viewport.height}.png`) });
      await page.getByRole("button", { name: "Your chats" }).click();
      assert.equal(await page.getByRole("button", { name: "Your chats" }).getAttribute("aria-expanded"), "false");
      if (viewport.width < 700) await page.keyboard.press("Escape");
      const preview = page.getByRole("button", { name: "Preview chat-preview.svg" });
      await preview.click();
      const dialog = page.getByRole("dialog", { name: "Image preview" });
      await dialog.waitFor();
      await page.screenshot({ path: path.join(tmpdir(), `neura-chat-preview-${viewport.width}x${viewport.height}.png`) });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Actions for chat-preview.svg" }).click();
      const menu = page.getByRole("menu", { name: "Attachment actions for chat-preview.svg" });
      const box = await menu.boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height);
      await page.getByRole("menuitem", { name: "Download to Workspace" }).click();
      const save = page.getByRole("dialog", { name: "Download to Workspace" });
      await save.getByRole("button", { name: "Save", exact: true }).click();
      await save.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Actions for chat-preview.svg" }).click();
      const downloading = page.waitForEvent("download");
      await page.getByRole("menuitem", { name: "Download", exact: true }).click();
      assert.equal((await downloading).suggestedFilename(), "chat-preview.svg");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
});

test("Team Terminal reaction pickers preserve input and fit desktop and narrow panes", { skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 90000 }, async () => {
  const require = createRequire(import.meta.url);
  const browser = await require(process.env.PLAYWRIGHT_MODULE_PATH).chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[1280, 900], [1280, 420], [390, 420], [320, 568]]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/workspace/api/terminals/*/gifs?*", (route) => route.fulfill({ json: { results: [{ id: "qa", token: "qa-selection", title: "Celebration", url: "https://static.klipy.com/qa.gif", preview: "https://static.klipy.com/qa.gif", still: "https://static.klipy.com/qa.png" }], next: "" } }));
      await page.route("https://static.klipy.com/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#604b91"/><text x="40" y="65" fill="white" font-size="20">Celebrate!</text></svg>' }));
      await page.goto(`${process.env.MOBILE_TEST_ORIGIN || "http://127.0.0.1:4196"}/workspace/tests/mobile.html`);
      await page.getByRole("navigation", { name: "QA applications" }).getByRole("button", { name: "Terminal", exact: true }).click();
      const sessions = page.getByRole("button", { name: "Open terminal sessions" });
      if (await sessions.isVisible()) {
        await sessions.click();
        await page.getByRole("dialog", { name: "Terminal sessions", exact: true }).getByRole("button", { name: /Release room/ }).click();
      } else {
        await page.getByRole("button", { name: "Open team session Release room" }).click();
      }
      if (width === 1280 && height === 900) {
        await page.getByRole("button", { name: "Split terminal vertically" }).click();
        await page.waitForFunction(() => document.querySelectorAll(".terminal-pane").length === 2);
      }
      const trigger = page.getByRole("button", { name: "Send a team reaction" });
      await trigger.waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll(".terminal-pane__state")].every((state) => state.classList.contains("is-connected")));
      const host = page.getByLabel("Release room interactive terminal");
      const box = await host.boundingBox();
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Emoji reactions" });
      await dialog.getByLabel("Search emoji").fill("woman technologist");
      await dialog.getByRole("button", { name: "Send Woman Technologist" }).waitFor();
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height);
      const openedBox = await host.boundingBox();
      assert.equal(openedBox.width, box.width, "opening picker preserves shell width");
      assert.equal(openedBox.height, box.height, "opening picker preserves shell height");
      await page.screenshot({ path: path.join(process.env.MOBILE_SCREENSHOT_DIR || tmpdir(), `terminal-emoji-${width}x${height}.png`) });
      await dialog.getByRole("button", { name: "Send Woman Technologist" }).click();
      await page.getByLabel("QA reacted with 👩‍💻").waitFor();
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains("xterm-helper-textarea")), true);
      assert.deepEqual(await page.evaluate(() => window.mobileQA.inputs), []);
      await page.keyboard.type("pwd");
      assert.equal((await page.evaluate(() => window.mobileQA.inputs)).join(""), "pwd");
      await page.getByRole("button", { name: "Send a GIF reaction" }).click();
      await page.getByRole("button", { name: "Send Celebration" }).waitFor();
      await page.screenshot({ path: path.join(process.env.MOBILE_SCREENSHOT_DIR || tmpdir(), `terminal-gif-picker-${width}x${height}.png`) });
      await page.getByRole("button", { name: "Send Celebration" }).click();
      await page.getByLabel("QA reacted with Celebration").waitFor();
      await page.screenshot({ path: path.join(process.env.MOBILE_SCREENSHOT_DIR || tmpdir(), `terminal-gif-overlay-${width}x${height}.png`) });
      assert.deepEqual((await page.evaluate(() => window.mobileQA.reactions)).at(-1), { type: "reaction", kind: "gif", token: "qa-selection" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
});
