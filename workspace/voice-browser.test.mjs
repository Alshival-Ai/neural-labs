// Synthetic media and API responses only; no microphone, provider, or signed-in account.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

test(
  "unified voice/send, mute, and recoverable Team memos on mobile",
  { skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 60000 },
  async () => {
    const require = createRequire(import.meta.url);
    const engine = process.env.BROWSER_ENGINE || "chromium";
    const browser = await require(process.env.PLAYWRIGHT_MODULE_PATH)[
      engine
    ].launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let transcriptionFails = false;
    const posts = [];
    await page.addInitScript(() => {
      const qa = { enabled: false, stopped: 0, acquired: 0 };
      window.voiceQA = qa;
      const track = {
        get enabled() {
          return qa.enabled;
        },
        set enabled(value) {
          qa.enabled = value;
        },
        stop() {
          qa.stopped++;
        },
      };
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            qa.acquired++;
            return { getAudioTracks: () => [track], getTracks: () => [track] };
          },
        },
      });
      window.RTCPeerConnection = class {
        connectionState = "connected";
        addTrack() {}
        close() {}
        createDataChannel() {
          return { addEventListener() {}, send() {} };
        }
        async createOffer() {
          return { type: "offer", sdp: "v=offer" };
        }
        async setLocalDescription() {}
        async setRemoteDescription() {}
      };
      window.MediaRecorder = class {
        static isTypeSupported(type) {
          return type.startsWith("audio/webm");
        }
        mimeType = "audio/webm";
        state = "inactive";
        start() {
          this.state = "recording";
        }
        stop() {
          this.state = "inactive";
          this.ondataavailable?.({
            data: new Blob(["synthetic audio"], { type: this.mimeType }),
          });
          this.onstop?.();
        }
      };
    });
    await page.route("**/workspace/api/neura/**", (route) =>
      route.request().url().endsWith("/transcriptions")
        ? route.fulfill({
            status: transcriptionFails ? 503 : 200,
            json: transcriptionFails
              ? { error: { message: "Transcription temporarily unavailable" } }
              : { text: "The launch is Friday. Ask @Neura about the release." },
          })
        : route.fulfill({
            status: 200,
            contentType: "application/sdp",
            body: "v=answer",
          }),
    );
    await page.route("**/workspace/api/files/**", (route) =>
      route.fulfill({
        status: 200,
        json: { item: { path: "team-uploads/test-memo.webm" } },
      }),
    );
    await page.route("**/api/team/channels/*/messages", (route) => {
      const body = route.request().postDataJSON();
      posts.push(body);
      return route.fulfill({
        status: 201,
        json: {
          message: {
            id: `memo-${posts.length}`,
            sequence: posts.length,
            channelId: "release",
            authorKind: "user",
            body: body.body,
            attachments: body.attachments,
            mentions: [],
            activities: [],
            createdAt: new Date().toISOString(),
          },
        },
      });
    });
    try {
      await page.goto("http://127.0.0.1:4196/workspace/tests/mobile.html");
      const mic = page.getByRole("button", {
        name: "Start private Neura voice chat",
        exact: true,
      });
      await mic.waitFor();
      const input = page.getByPlaceholder("Message Neura…");
      await input.fill("Hello");
      assert.equal(await mic.count(), 0);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .waitFor();
      await input.fill("");
      await mic.tap();
      await page
        .getByText("Voice call · microphone on", { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Mute microphone", exact: true })
        .tap();
      assert.equal(await page.evaluate(() => window.voiceQA.enabled), false);
      await input.fill("Text during a call");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Unmute microphone", exact: true })
        .tap();
      assert.equal(await page.evaluate(() => window.voiceQA.enabled), true);
      await page.screenshot({ path: `/tmp/neura-voice-mobile-${engine}.png` });
      await page
        .getByRole("button", {
          name: "End private Neura voice chat",
          exact: true,
        })
        .tap();
      await input.fill("");
      const privateVoiceMode = page.getByRole("switch", { name: "Hold to talk" });
      assert.equal(await privateVoiceMode.getAttribute("aria-checked"), "false");
      await privateVoiceMode.tap();
      assert.equal(await privateVoiceMode.getAttribute("aria-checked"), "true");
      const hold = page.getByRole("button", {
        name: "Hold to speak with Neura",
      });
      await hold.focus();
      await page.keyboard.down("Space");
      await page
        .getByText("Voice call · microphone on", { exact: true })
        .waitFor();
      await page.keyboard.up("Space");
      assert.equal(await page.evaluate(() => window.voiceQA.enabled), false);
      await page
        .getByRole("button", {
          name: "End private Neura voice chat",
          exact: true,
        })
        .tap();
      await privateVoiceMode.tap();
      await page
        .getByRole("button", { name: "Open conversation history" })
        .tap();
      await page.getByRole("button", { name: /Release planning/ }).tap();
      const memo = page.getByRole("button", {
        name: "Hold to record a Team Chat voice memo",
        exact: true,
      });
      await memo.waitFor();
      assert.equal(await page.getByRole("switch", { name: "Hold to talk" }).count(), 0);
      const teamInput = page.getByPlaceholder(
        "Message #Release planning · @ tags people · $ lists skills",
      );
      await teamInput.fill("@");
      await page.getByRole("listbox", { name: "Team Chat mentions" }).waitFor();
      await page.getByRole("option", { name: /Salvador/ }).waitFor();
      await teamInput.fill("@sal");
      const selectedMention = page.getByRole("option", { name: /Salvador/ });
      assert.match(await selectedMention.evaluate((element) => getComputedStyle(element).backgroundImage), /linear-gradient/);
      assert.notEqual(await selectedMention.evaluate((element) => getComputedStyle(element).boxShadow), "none");
      await teamInput.press("Enter");
      assert.equal(await teamInput.inputValue(), "@salvador ");
      assert.equal(await page.evaluate(() => window.mobileQA.teamPosts.length), 0);
      await teamInput.fill("First line");
      await teamInput.press("Shift+Enter");
      assert.equal(await teamInput.inputValue(), "First line\n");
      assert.equal(await page.evaluate(() => window.mobileQA.teamPosts.length), 0);
      await teamInput.fill("Team text");
      assert.equal(await memo.count(), 0);
      await page
        .getByRole("button", { name: "Send Team Chat message", exact: true })
        .waitFor();
      await teamInput.press("Enter");
      assert.equal(await page.evaluate(() => window.mobileQA.teamPosts.length), 1);
      await teamInput.fill("");
      await memo.hover();
      await page.mouse.down();
      await page
        .getByRole("button", { name: "Release to send Team Chat voice memo" })
        .waitFor();
      await page.mouse.up();
      await page
        .getByText("The launch is Friday. Ask @Neura about the release.", {
          exact: false,
        })
        .waitFor();
      assert.equal(posts.length, 1);
      assert.equal(posts[0].invokeAgent, false);
      assert.match(posts[0].body, /^Voice memo transcript:/);
      assert.equal(posts[0].attachments[0].type, "audio/webm");
      assert.equal(
        await page.getByRole("region", { name: "Unsent voice memo" }).count(),
        0,
      );
      transcriptionFails = true;
      await memo.hover();
      await page.mouse.down();
      await page
        .getByRole("button", { name: "Release to send Team Chat voice memo" })
        .waitFor();
      await page.mouse.up();
      await page
        .getByText("Transcription temporarily unavailable", { exact: true })
        .waitFor();
      assert.equal(posts.length, 1);
      for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const recovery = page.getByRole("region", {
          name: "Unsent voice memo",
        });
        assert.ok((await recovery.boundingBox()).width <= width);
      }
      await page.screenshot({ path: `/tmp/neura-memo-recovery-${engine}.png` });
      transcriptionFails = false;
      await page
        .getByRole("button", { name: "Retry transcription & send" })
        .click();
      await page
        .getByRole("region", { name: "Unsent voice memo" })
        .waitFor({ state: "detached" });
      assert.equal(posts.length, 2);
      assert.equal(posts[1].invokeAgent, false);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
