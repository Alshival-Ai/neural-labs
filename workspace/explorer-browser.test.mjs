// Optional real-browser acceptance. Build workspace/desktop first, install Playwright
// and its browsers in a separate tools directory, then run:
// PLAYWRIGHT_MODULE_PATH=/absolute/path/to/playwright-core BROWSER_ENGINE=chromium \
//   node --test workspace/explorer-browser.test.mjs
// Repeat with firefox and webkit. No production filesystem or identity is used.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkspaceHttpServer } from "./http-server.mjs";

test(
  "Explorer and miniPaint work against real APIs, including touch navigation",
  {
    skip: !process.env.PLAYWRIGHT_MODULE_PATH,
    timeout: 90000,
  },
  async () => {
    const require = createRequire(import.meta.url);
    const engine = process.env.BROWSER_ENGINE || "chromium";
    const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH);
    const browser = await playwright[engine].launch({ headless: true });
    const fixtureHome = await mkdtemp(
      path.join(tmpdir(), "neural-explorer-browser-"),
    );
    const root = path.join(fixtureHome, "workspace");
    const desktopRoot = fileURLToPath(
      new URL("./desktop/dist", import.meta.url),
    );
    const port = Number(process.env.EXPLORER_TEST_PORT || 4197);
    const origin = `http://127.0.0.1:${port}`;
    await mkdir(path.join(root, "projects"), { recursive: true });
    await writeFile(path.join(root, "notes.md"), "# Sample note");
    const server = createWorkspaceHttpServer({
      desktopRoot,
      workspaceRoot: root,
      publicOrigin: origin,
      gatewayReady: async () => true,
      providerAuthenticated: () => false,
      openclawModelReady: () => false,
    });
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    async function pageFor(context) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/api/**", async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        const fixtures = {
          "/api/session": {
            authenticated: true,
            csrfToken: "test",
            providers: ["local"],
            user: {
              id: "alice",
              email: "alice@example.test",
              displayName: "Alice",
              role: "user",
              status: "active",
            },
          },
          "/api/workspace": { status: "ready" },
          "/api/account/openai": {
            agentId: "alice",
            authenticated: false,
            paused: false,
          },
        };
        if (fixtures[pathname])
          return route.fulfill({ json: fixtures[pathname] });
        return route.continue({
          headers: {
            ...route.request().headers(),
            "x-forwarded-user": "alice",
          },
        });
      });
      await page.addInitScript(() => {
        if (window === window.top)
          localStorage.setItem(
            "neural-labs.device-state.v1.alice.desktop",
            JSON.stringify({
              windows: [
                {
                  id: "files-test",
                  app: "files",
                  visibility: "open",
                  order: 1,
                },
              ],
            }),
          );
      });
      await page.goto(`${origin}/workspace`);
      await page.getByRole("row", { name: "projects, Folder" }).waitFor();
      return { page, errors };
    }
    try {
      const { page, errors } = await pageFor(
        await browser.newContext({ viewport: { width: 1500, height: 1000 } }),
      );
      await page
        .getByRole("button", { name: "More actions for projects" })
        .click();
      await page.getByRole("menuitem", { name: "Pin to sidebar" }).click();
      await page
        .getByLabel("Pinned folders")
        .getByRole("button", { name: "projects" })
        .waitFor();
      await page
        .getByRole("button", { name: "Maximize Files", exact: true })
        .click();
      await page.screenshot({
        path: path.join(tmpdir(), `neural-explorer-${engine}.png`),
      });
      const uploaded = await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 240;
        canvas.height = 160;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "red";
        ctx.fillRect(0, 0, 120, 160);
        ctx.fillStyle = "blue";
        ctx.fillRect(120, 0, 120, 160);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve));
        return fetch("/workspace/api/files/upload?path=&name=photo.png", {
          method: "POST",
          body: blob,
        }).then((r) => r.json());
      });
      assert.equal(uploaded.item.name, "photo.png");
      await page.getByRole("row", { name: "photo.png, PNG" }).waitFor();
      await page
        .getByRole("button", { name: "More actions for photo.png" })
        .click();
      await page.getByRole("menuitem", { name: "Edit image" }).click();
      const editor = page.getByLabel("Image Editor — photo.png application");
      await editor.getByRole("button", { name: "Save", exact: true }).waitFor();
      const frame = page.frameLocator('iframe[title="miniPaint Image Editor"]');
      await frame.locator("canvas#canvas_minipaint").waitFor();
      const child = page
        .frames()
        .find((f) => f.url().includes("/image-editor/"));
      await child.waitForFunction(
        () =>
          window.AppConfig?.WIDTH === 240 &&
          window.AppConfig?.layers?.length === 1,
      );
      assert.equal(
        await child.evaluate(() => {
          try {
            return !!parent.document;
          } catch {
            return false;
          }
        }),
        false,
      );
      await frame.getByRole("menuitem", { name: "Image", exact: true }).click();
      await frame.getByRole("menuitem", { name: /^Rotate/ }).click();
      await frame.getByText("270", { exact: true }).click();
      await frame.locator('[data-id="popup_ok"]').click();
      await child.waitForFunction(() => window.AppConfig.layer.rotate === 270);
      await child.evaluate(async () => {
        await window.State.undo();
        await window.State.redo();
      });
      assert.equal(
        await child.evaluate(() => window.AppConfig.layer.rotate),
        270,
      );
      await editor
        .getByRole("button", { name: "Save As", exact: true })
        .click();
      const save = page.getByRole("dialog", {
        name: "Save image or layered project as",
      });
      await save.getByRole("textbox").fill("edited.minipaint.json");
      await save.getByRole("button", { name: "Save", exact: true }).click();
      await page
        .getByText("Saved edited.minipaint.json", { exact: true })
        .waitFor();
      const project = JSON.parse(
        await readFile(path.join(root, "edited.minipaint.json"), "utf8"),
      );
      assert.equal(project.layers[0].rotate, 270);
      await editor
        .getByRole("button", { name: "Export image", exact: true })
        .click();
      const exported = page.getByRole("dialog", {
        name: "Export flattened image",
      });
      await exported.getByRole("textbox").fill("edited.png");
      await exported
        .getByRole("button", { name: "Export", exact: true })
        .click();
      await page
        .getByText("Saved edited.png. The layered project remains open.", {
          exact: true,
        })
        .waitFor();
      assert.deepEqual(
        (await readFile(path.join(root, "edited.png"))).subarray(0, 8),
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      await editor.getByRole("button", { name: "Open", exact: true }).click();
      const opened = page.getByRole("dialog", { name: "Open workspace image" });
      await opened.getByRole("textbox").fill("edited.minipaint.json");
      await opened.getByRole("button", { name: "Save", exact: true }).click();
      await opened.waitFor({ state: "hidden" });
      await child.waitForFunction(() => window.AppConfig.layer.rotate === 270);
      await editor
        .getByText("Opening image…", { exact: true })
        .waitFor({ state: "hidden" });
      // A direct collaborator write invalidates the editor's captured version.
      await writeFile(
        path.join(root, "edited.minipaint.json"),
        "collaborator changed this file",
      );
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await editor.getByText(/This file changed/).waitFor();
      assert.equal(
        await readFile(path.join(root, "edited.minipaint.json"), "utf8"),
        "collaborator changed this file",
      );
      await page.screenshot({
        path: path.join(tmpdir(), `neural-image-editor-${engine}.png`),
      });
      assert.deepEqual(errors, []);
      const touch = await pageFor(
        await browser.newContext({
          viewport: { width: 390, height: 844 },
          hasTouch: true,
        }),
      );
      await touch.page
        .getByRole("button", { name: "More actions for projects" })
        .tap();
      await touch.page
        .getByRole("menuitem", { name: "Open", exact: true })
        .tap();
      await touch.page.getByRole("button", { name: "Back", exact: true }).tap();
      await touch.page.getByRole("row", { name: "projects, Folder" }).waitFor();
      await touch.page.screenshot({
        path: path.join(tmpdir(), `neural-explorer-touch-${engine}.png`),
      });
      assert.deepEqual(touch.errors, []);
    } catch (error) {
      const diagnostic = browser.contexts()[0]?.pages()[0];
      if (diagnostic) {
        await diagnostic
          .screenshot({
            path: path.join(tmpdir(), `neural-explorer-failed-${engine}.png`),
          })
          .catch(() => {});
        const child = diagnostic
          .frames()
          .find((f) => f.url().includes("/image-editor/"));
        if (child)
          console.error((await child.locator("body").innerText()).slice(-2500));
      }
      throw error;
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
      await rm(fixtureHome, { recursive: true, force: true });
    }
  },
);
