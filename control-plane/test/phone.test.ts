import { describe, expect, it, vi } from "vitest";
import {
  normalizePhone,
  PhoneService,
  PhoneStore,
  TwilioSmsSender,
} from "../src/phone.js";

describe("phone verification", () => {
  it("normalizes international numbers without guessing a country", () => {
    expect(normalizePhone(" +1 (202) 555-0123 ")).toBe("+12025550123");
    for (const number of [
      "2025550123",
      "+0123456789",
      "+123",
      "+12025550123 ext 4",
      "+1234567890123456",
    ]) {
      expect(() => normalizePhone(number)).toThrow(/international/);
    }
  });
  it("sends only through Twilio's fixed HTTPS API and accepts queued messages", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ sid: "SM-test", status: "queued" }), {
          status: 201,
        }),
      );
    const sender = new TwilioSmsSender(
      {
        accountSid: `AC${"a".repeat(32)}`,
        authToken: "test-secret",
        fromNumber: "+12025550100",
      },
      fetchFn,
    );
    await sender.send("+12025550123", "000123");
    const [url, options] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/AC${"a".repeat(32)}/Messages.json`,
    );
    expect(options).toMatchObject({ method: "POST", redirect: "error" });
    expect((options?.body as URLSearchParams).get("To")).toBe("+12025550123");
    expect((options?.body as URLSearchParams).get("Body")).toContain("000123");
  });
  it("fails safely without credentials or when the provider rejects delivery", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "private provider details" }), {
          status: 400,
        }),
      );
    await expect(
      new TwilioSmsSender(undefined, fetchFn).send("+12025550123", "123456"),
    ).rejects.toMatchObject({ code: "sms_not_configured" });
    expect(fetchFn).not.toHaveBeenCalled();
    const sender = new TwilioSmsSender(
      { accountSid: "test", authToken: "secret", fromNumber: "+12025550100" },
      fetchFn,
    );
    await expect(sender.send("+12025550123", "123456")).rejects.toMatchObject({
      code: "sms_unavailable",
      message: expect.not.stringContaining("private"),
    });
  });
  function fixture() {
    const store = {
      get: vi.fn(async () => ({
        phoneNumber: null,
        verifiedAt: null,
        pending: null,
        resendAt: null,
      })),
      reserve: vi.fn(async () => true),
      delivered: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      verify: vi.fn(async () => true),
      remove: vi.fn(async () => {}),
    };
    const sms = {
      available: true,
      send: vi.fn(async (_number: string, _code: string) => {}),
    };
    const rate = vi.fn(async () => true);
    return {
      store,
      sms,
      rate,
      service: new PhoneService(
        store as unknown as PhoneStore,
        sms,
        Buffer.alloc(32, 7),
        rate,
      ),
    };
  }
  it("stores only a keyed, user/challenge-bound digest and never returns the OTP", async () => {
    const { store, sms, service, rate } = fixture();
    const result = await service.start(
      "user-one",
      "+1 202 555 0123",
      "192.0.2.1",
    );
    const call = store.reserve.mock.calls[0] as unknown as [
      string,
      string,
      string,
      string,
    ];
    const code = sms.send.mock.calls[0]![1];
    expect(code).toMatch(/^\d{6}$/);
    expect(call[3]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain(code);
    await service.verify("user-one", call[2], code);
    expect(store.verify).toHaveBeenLastCalledWith("user-one", call[2], call[3]);
    await service.verify("user-two", call[2], code);
    expect(store.verify).not.toHaveBeenLastCalledWith(
      "user-two",
      call[2],
      call[3],
    );
    expect(JSON.stringify(rate.mock.calls)).not.toContain("+12025550123");
    expect(JSON.stringify(rate.mock.calls)).not.toContain("192.0.2.1");
  });
  it("does not send when rate limited or another request reserved the cooldown", async () => {
    const { store, sms, service, rate } = fixture();
    rate.mockResolvedValueOnce(false);
    await expect(
      service.start("u", "+12025550123", "ip"),
    ).rejects.toMatchObject({ status: 429 });
    store.reserve.mockResolvedValue(false);
    await expect(
      service.start("u", "+12025550123", "ip"),
    ).rejects.toMatchObject({ code: "phone_resend_wait" });
    expect(sms.send).not.toHaveBeenCalled();
  });
  it("invalidates a failed send without clearing a previously verified number", async () => {
    const { store, sms, service } = fixture();
    sms.send.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(service.start("u", "+12025550123", "ip")).rejects.toThrow();
    expect(store.cancel).toHaveBeenCalledWith("u", expect.any(String));
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.delivered).not.toHaveBeenCalled();
  });
});
