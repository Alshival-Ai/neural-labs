// Local UI fixture with synthetic SMS/API responses. Never sends a real SMS.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

test(
  "phone verification in Personalization on mobile and desktop",
  { skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 60000 },
  async () => {
    const require = createRequire(import.meta.url);
    const browser = await require(process.env.PLAYWRIGHT_MODULE_PATH)[
      process.env.BROWSER_ENGINE || "chromium"
    ].launch({ headless: true });
    try {
      for (const width of [320, 390, 1280]) {
        const page = await browser.newPage({
          viewport: { width, height: 844 },
          hasTouch: width < 500,
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        let state = {
          available: true,
          phoneNumber: null,
          verifiedAt: null,
          pending: null,
          resendAt: null,
        };
        await page.route("**/api/**", async (route) => {
          const url = new URL(route.request().url());
          if (url.pathname === "/api/auth/providers")
            return route.fulfill({
              json: {
                local: { enabled: true },
                microsoft: { available: true, enabled: true },
              },
            });
          if (url.pathname === "/api/account/passkeys")
            return route.fulfill({ json: { eligible: true, passkeys: [] } });
          if (url.pathname === "/api/account/openai")
            return route.fulfill({
              json: {
                provider: "openai",
                state: "disconnected",
                authenticated: false,
                modelReady: false,
                paused: false,
              },
            });
          if (!url.pathname.startsWith("/api/account/phone"))
            return route.fulfill({ status: 404, json: {} });
          if (route.request().method() !== "GET") {
            assert.equal(
              route.request().headers()["x-csrf-token"],
              "phone-test-csrf",
            );
            if (url.pathname.endsWith("/request")) {
              const body = route.request().postDataJSON();
              assert.equal(body.consent, true);
              state.pending = {
                phoneNumber: "+12025550123",
                challengeId: "22222222-2222-4222-8222-222222222222",
                expiresAt: new Date(Date.now() + 600000).toISOString(),
                attemptsRemaining: 5,
                deliveryAccepted: true,
              };
              state.resendAt = new Date(Date.now() + 60000).toISOString();
            } else if (url.pathname.endsWith("/verify")) {
              if (route.request().postDataJSON().code !== "000123") {
                state.pending.attemptsRemaining--;
                return route.fulfill({
                  status: 422,
                  json: {
                    error: {
                      message:
                        "The code is incorrect. Check the SMS and try again.",
                    },
                  },
                });
              }
              state.phoneNumber = state.pending.phoneNumber;
              state.verifiedAt = new Date().toISOString();
              state.pending = null;
            } else if (route.request().method() === "DELETE") {
              state.phoneNumber = null;
              state.verifiedAt = null;
            }
          }
          return route.fulfill({ json: state });
        });
        await page.goto("http://127.0.0.1:4196/workspace/tests/phone.html");
        const card = page.getByRole("region", {
          name: "Phone number",
          exact: true,
        });
        await card.scrollIntoViewIfNeeded();
        await card
          .getByLabel("Phone number", { exact: true })
          .fill("+1 202 555 0123");
        assert.equal(
          await card
            .getByRole("button", { name: "Send verification code" })
            .isDisabled(),
          true,
        );
        await card.getByRole("checkbox").check();
        await card
          .getByRole("button", { name: "Send verification code" })
          .click();
        const code = card.getByLabel("Six-digit verification code");
        await code.fill("111111");
        await card.getByRole("button", { name: "Verify number" }).click();
        await card.getByRole("alert").waitFor();
        await card.getByText(/4 attempts remaining/).waitFor();
        await code.fill("000123");
        await card.getByRole("button", { name: "Verify number" }).click();
        await card.getByText("Verified", { exact: true }).waitFor();
        await card.getByRole("button", { name: "Change number" }).click();
        await card.getByLabel("New phone number").waitFor();
        assert.equal(
          await card.getByText("Verified", { exact: true }).isVisible(),
          true,
        );
        await card.getByRole("button", { name: "Cancel change" }).click();
        const layout = await card.evaluate((element) => ({
          width: element.getBoundingClientRect().width,
          viewport: innerWidth,
          overflow: element.scrollWidth > element.clientWidth + 1,
          smallButtons: [...element.querySelectorAll("button")].filter(
            (button) => button.getBoundingClientRect().height < 44,
          ).length,
        }));
        assert.ok(layout.width <= layout.viewport);
        assert.equal(layout.overflow, false);
        assert.equal(layout.smallButtons, 0);
        if (width === 390 && process.env.PHONE_QA_SCREENSHOT)
          await page.screenshot({ path: process.env.PHONE_QA_SCREENSHOT });
        await card.getByRole("button", { name: "Remove number" }).click();
        await card.getByRole("button", { name: "Confirm removal" }).click();
        await card.getByText("Phone number removed.").waitFor();
        assert.deepEqual(errors, []);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  },
);
