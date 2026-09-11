// Start the desktop Vite server on port 4196, then run with PLAYWRIGHT_MODULE_PATH.
// Uses a generated clip and synthetic paths; no production identity or media.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("chat videos preview, play, seek, and load lazily on desktop and mobile", {
  skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 90000,
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "neura-video-"));
  let browser;
  try {
    const clip = path.join(directory, "sample.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", clip]);
    const bytes = await readFile(clip);
    const playwright = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);
    browser = await playwright.chromium.launch({ headless: true });
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const requested = [];
      await page.route("**/workspace/api/files/content?**", async (route) => {
        requested.push(new URL(route.request().url()).searchParams.get("path"));
        await route.fulfill({ status: 200, contentType: "video/mp4", body: bytes });
      });
      await page.goto(`${process.env.CHAT_VIDEO_TEST_ORIGIN || "http://127.0.0.1:4196"}/workspace/tests/chat-video.html`);
      const video = page.getByLabel("Play sample.mp4", { exact: true });
      await video.waitFor();
      await page.waitForFunction(() => {
        const video = document.querySelector("video");
        return video.readyState >= 2 && video.currentTime >= .09 && !video.seeking;
      });
      assert.equal(await video.evaluate((el) => el.paused), true, "preview does not autoplay");
      assert.ok(!requested.includes("later.mp4"), "offscreen video is not downloaded");
      assert.equal(await video.evaluate((el) => {
        const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
        const context = canvas.getContext("2d"); context.drawImage(el, 0, 0, 1, 1);
        return context.getImageData(0, 0, 1, 1).data.slice(0, 3).some((value) => value > 10);
      }), true, "a decoded frame is visible");
      const bounds = await video.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
      await video.evaluate((el) => el.play());
      await page.waitForFunction(() => document.querySelector("video").currentTime > .4);
      await video.evaluate((el) => { el.pause(); el.currentTime = 2.5; });
      await page.waitForFunction(() => {
        const video = document.querySelector("video"); return !video.seeking && video.currentTime >= 2.5;
      });
      await page.getByRole("button", { name: "Actions for sample.mp4", exact: true }).click();
      assert.equal(await page.getByRole("menuitem", { name: "Download", exact: true }).isVisible(), true);
      await page.keyboard.press("Escape");
      await page.screenshot({ path: path.join(tmpdir(), `neura-video-${viewport.width}.png`) });
      await page.getByLabel("Play later.mp4", { exact: true }).scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelectorAll("video")[1].readyState >= 2);
      assert.ok(requested.includes("later.mp4"));
      await page.close();
    }
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
