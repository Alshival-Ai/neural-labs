import { describe, expect, it, vi } from "vitest";

import { CredentialCipher } from "../src/crypto.js";
import { TwilioPluginService, twilioNotificationSchema } from "../src/twilioPlugin.js";

const config = {
  accountSid: `AC${"0".repeat(32)}`, // Synthetic test SID; never a real account.,
  authToken: "private-test-token",
  fromNumber: "+12025550123",
};

describe("Twilio workspace plugin", () => {
  it("never accepts an arbitrary phone number as an agent notification target", () => {
    expect(twilioNotificationSchema.safeParse({
      phoneNumber: "+12025550199",
      message: "Automation complete",
    }).success).toBe(false);
  });

  it("uses environment credentials only as a migration fallback and exposes safe status", async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    const service = new TwilioPluginService(
      pool as never,
      new CredentialCipher(Buffer.alloc(32, 7)),
      config,
      vi.fn() as unknown as typeof fetch,
    );
    const status = await service.status("https://neural-labs.example.org/webhooks/twilio/sms", false);
    expect(status).toMatchObject({ configured: true, source: "environment", editable: false });
    expect(status.accountSidHint).not.toContain(config.accountSid);
    expect(JSON.stringify(status)).not.toContain(config.authToken);
  });

  it("sends only after resolving an active, verified, opted-in workspace member", async () => {
    const cipher = new CredentialCipher(Buffer.alloc(32, 8));
    const pool = { query: vi.fn(async (sql: string) => {
      if (sql.includes("plugin_connections")) return { rows: [{
        enabled: true,
        public_config: { accountSid: config.accountSid, fromNumber: config.fromNumber },
        encrypted_credentials: cipher.encrypt({ authToken: config.authToken }),
        revision: "2",
        applied_revision: null,
        apply_error: null,
        source: "settings",
        updated_at: new Date(),
      }] };
      return { rows: [{ id: "11111111-1111-4111-8111-111111111111", handle: "salvador", phone_number: "+12025550199" }] };
    }) };
    const fetchFn = vi.fn(async (_url, init) => {
      const body = init?.body as URLSearchParams;
      expect(body.get("To")).toBe("+12025550199");
      expect(body.getAll("MediaUrl")).toEqual(["https://media.example.org/result.jpg"]);
      return Response.json({ sid: "SM-test", status: "queued" });
    });
    const service = new TwilioPluginService(pool as never, cipher, undefined, fetchFn as typeof fetch);
    await expect(service.sendNotification({
      handle: "salvador",
      message: "Your automation is complete.",
      mediaUrls: ["https://media.example.org/result.jpg"],
    })).resolves.toEqual({ recipient: "@salvador", mediaCount: 1 });
  });
});
