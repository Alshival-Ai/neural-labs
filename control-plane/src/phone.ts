import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Pool } from "pg";

export type SmsConfig = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
};
export class PhoneError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function normalizePhone(value: string): string {
  const number = value.trim().replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(number))
    throw new PhoneError(
      422,
      "invalid_phone",
      "Enter an international phone number with country code, such as +1 202 555 0123.",
    );
  return number;
}
export class TwilioSmsSender {
  constructor(
    private config?: SmsConfig,
    private fetchFn: typeof fetch = fetch,
  ) {}
  get available() {
    return Boolean(this.config);
  }
  async send(number: string, code: string): Promise<void> {
    if (!this.config)
      throw new PhoneError(
        503,
        "sms_not_configured",
        "SMS verification is not configured. Contact your administrator.",
      );
    const { accountSid, authToken, fromNumber } = this.config;
    try {
      const response = await this.fetchFn(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: number,
            From: fromNumber,
            Body: `Your Neural Labs verification code is ${code}. Expires in 10 minutes. Do not share it. Reply STOP to opt out, HELP for help.`,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      const payload = (await response.json()) as {
        sid?: string;
        status?: string;
      };
      if (
        !response.ok ||
        !payload.sid ||
        ["failed", "undelivered", "canceled"].includes(payload.status ?? "")
      )
        throw new Error("SMS rejected");
    } catch {
      // Do not expose provider responses, numbers, codes, or credentials.
      throw new PhoneError(
        503,
        "sms_unavailable",
        "The verification SMS could not be sent. Check the number and try again later.",
      );
    }
  }
}
type PhoneRow = {
  phone_number: string | null;
  verified_at: Date | null;
  pending_number: string | null;
  challenge_id: string | null;
  code_hash: string | null;
  expires_at: Date | null;
  attempts: number;
  sent_at: Date | null;
  delivery_accepted: boolean;
  notifications_enabled: boolean;
};
export type PhoneStatus = {
  available: boolean;
  notificationsEnabled: boolean;
  phoneNumber: string | null;
  verifiedAt: string | null;
  pending: {
    phoneNumber: string;
    challengeId: string;
    expiresAt: string;
    attemptsRemaining: number;
    deliveryAccepted: boolean;
  } | null;
  resendAt: string | null;
};
const CLEAR_PENDING =
  "pending_number = NULL, challenge_id = NULL, code_hash = NULL, expires_at = NULL, attempts = 0, delivery_accepted = false";
export class PhoneStore {
  constructor(private pool: Pool) {}
  async get(userId: string): Promise<Omit<PhoneStatus, "available">> {
    const row = (
      await this.pool.query<PhoneRow>(
        "SELECT * FROM user_phones WHERE user_id = $1",
        [userId],
      )
    ).rows[0];
    return {
      notificationsEnabled: row?.notifications_enabled ?? false,
      phoneNumber: row?.phone_number ?? null,
      verifiedAt: row?.verified_at?.toISOString() ?? null,
      pending:
        row?.pending_number && row.challenge_id && row.expires_at
          ? {
              phoneNumber: row.pending_number,
              challengeId: row.challenge_id,
              expiresAt: row.expires_at.toISOString(),
              attemptsRemaining: Math.max(0, 5 - row.attempts),
              deliveryAccepted: row.delivery_accepted,
            }
          : null,
      resendAt: row?.sent_at
        ? new Date(row.sent_at.getTime() + 60_000).toISOString()
        : null,
    };
  }
  async reserve(
    userId: string,
    number: string,
    challengeId: string,
    codeHash: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO user_phones(user_id, pending_number, challenge_id, code_hash, expires_at, sent_at)
       VALUES ($1, $2, $3, $4, now() + interval '10 minutes', now())
       ON CONFLICT (user_id) DO UPDATE SET pending_number = $2, challenge_id = $3, code_hash = $4,
         expires_at = now() + interval '10 minutes', sent_at = now(), attempts = 0, delivery_accepted = false
       WHERE user_phones.sent_at IS NULL OR user_phones.sent_at <= now() - interval '60 seconds'
       RETURNING user_id`,
      [userId, number, challengeId, codeHash],
    );
    return Boolean(result.rowCount);
  }
  async delivered(userId: string, challengeId: string): Promise<void> {
    await this.pool.query(
      "UPDATE user_phones SET delivery_accepted = true WHERE user_id = $1 AND challenge_id = $2",
      [userId, challengeId],
    );
  }
  async cancel(userId: string, challengeId: string): Promise<void> {
    await this.pool.query(
      `UPDATE user_phones SET ${CLEAR_PENDING} WHERE user_id = $1 AND challenge_id = $2`,
      [userId, challengeId],
    );
  }
  async remove(userId: string): Promise<void> {
    // Keep send timestamp: removal must not bypass resend limits.
    await this.pool.query(
      `UPDATE user_phones SET phone_number = NULL, verified_at = NULL, notifications_enabled = false, updated_at = now(), ${CLEAR_PENDING} WHERE user_id = $1`,
      [userId],
    );
  }
  async verify(
    userId: string,
    challengeId: string,
    codeHash: string,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = (
        await client.query<PhoneRow & { valid: boolean }>(
          "SELECT *, expires_at > now() AS valid FROM user_phones WHERE user_id = $1 FOR UPDATE",
          [userId],
        )
      ).rows[0];
      if (
        !row ||
        row.challenge_id !== challengeId ||
        !row.valid ||
        !row.delivery_accepted ||
        !row.code_hash ||
        row.attempts >= 5
      ) {
        await client.query("COMMIT");
        return false;
      }
      const expected = Buffer.from(row.code_hash, "hex");
      const submitted = Buffer.from(codeHash, "hex");
      if (
        expected.length !== submitted.length ||
        !timingSafeEqual(expected, submitted)
      ) {
        await client.query(
          "UPDATE user_phones SET attempts = attempts + 1 WHERE user_id = $1",
          [userId],
        );
        await client.query("COMMIT");
        return false;
      }
      await client.query(
        `UPDATE user_phones SET phone_number = pending_number, verified_at = now(), notifications_enabled = false, updated_at = now(), ${CLEAR_PENDING} WHERE user_id = $1`,
        [userId],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505")
        throw new PhoneError(
          409,
          "phone_unavailable",
          "This number cannot be linked. Use a different number or contact support.",
        );
      throw error;
    } finally {
      client.release();
    }
  }

  async setNotifications(userId: string, enabled: boolean): Promise<void> {
    const result = await this.pool.query(
      `UPDATE user_phones
       SET notifications_enabled = $2, updated_at = now()
       WHERE user_id = $1 AND phone_number IS NOT NULL AND verified_at IS NOT NULL`,
      [userId, enabled],
    );
    if (!result.rowCount) {
      throw new PhoneError(
        409,
        "phone_not_verified",
        "Verify a phone number before enabling agent SMS notifications.",
      );
    }
  }
}

export interface VerificationSmsTransport {
  available: boolean | (() => boolean | Promise<boolean>);
  send(number: string, code: string): Promise<void>;
}
export class PhoneService {
  constructor(
    private store: PhoneStore,
    private sms: VerificationSmsTransport,
    private masterKey: Buffer,
    private consumeRateLimit: (
      key: string,
      limit: number,
      seconds: number,
    ) => Promise<boolean>,
  ) {}
  private hash(...values: string[]) {
    return createHmac("sha256", this.masterKey)
      .update(JSON.stringify(["phone-verification-v1", ...values]))
      .digest("hex");
  }
  private async smsAvailable(): Promise<boolean> {
    return typeof this.sms.available === "function"
      ? await this.sms.available()
      : this.sms.available;
  }
  async status(userId: string): Promise<PhoneStatus> {
    return { available: await this.smsAvailable(), ...(await this.store.get(userId)) };
  }
  async start(
    userId: string,
    rawNumber: string,
    ip: string,
  ): Promise<PhoneStatus> {
    if (!(await this.smsAvailable()))
      throw new PhoneError(
        503,
        "sms_not_configured",
        "SMS verification is not configured. Contact your administrator.",
      );
    const number = normalizePhone(rawNumber);
    for (const [key, limit] of [
      [`user:${userId}`, 5],
      [`number:${this.hash(number)}`, 5],
      [`ip:${this.hash(ip)}`, 20],
      ["global", 200],
    ] as const) {
      if (!(await this.consumeRateLimit(`phone-send:${key}`, limit, 3600)))
        throw new PhoneError(
          429,
          "phone_rate_limited",
          "Too many verification requests. Try again in an hour.",
        );
    }
    const challengeId = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    if (
      !(await this.store.reserve(
        userId,
        number,
        challengeId,
        this.hash(userId, challengeId, code),
      ))
    )
      throw new PhoneError(
        429,
        "phone_resend_wait",
        "Wait 60 seconds before requesting another code.",
      );
    try {
      await this.sms.send(number, code);
      await this.store.delivered(userId, challengeId);
    } catch (error) {
      await this.store.cancel(userId, challengeId);
      throw error;
    }
    return this.status(userId);
  }
  async verify(
    userId: string,
    challengeId: string,
    code: string,
  ): Promise<PhoneStatus> {
    if (!(await this.consumeRateLimit(`phone-verify:${userId}`, 30, 3600)))
      throw new PhoneError(
        429,
        "phone_rate_limited",
        "Too many verification attempts. Try again in an hour.",
      );
    if (
      !(await this.store.verify(
        userId,
        challengeId,
        this.hash(userId, challengeId, code),
      ))
    )
      throw new PhoneError(
        422,
        "invalid_phone_code",
        "The code is incorrect, expired, or no longer usable. Check the code or request a new one.",
      );
    return this.status(userId);
  }
  async cancel(userId: string, challengeId: string) {
    await this.store.cancel(userId, challengeId);
    return this.status(userId);
  }
  async remove(userId: string) {
    await this.store.remove(userId);
    return this.status(userId);
  }
  async setNotifications(userId: string, enabled: boolean) {
    await this.store.setNotifications(userId, enabled);
    return this.status(userId);
  }
}
