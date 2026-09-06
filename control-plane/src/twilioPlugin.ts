import type { Pool } from "pg";
import { z } from "zod";

import { CredentialCipher } from "./crypto.js";
import { normalizePhone, PhoneError, type SmsConfig, type VerificationSmsTransport } from "./phone.js";

const PLUGIN_ID = "twilio-sms";
const accountSidSchema = z.string().trim().regex(/^AC[a-f0-9]{32}$/i);
const authTokenSchema = z.string().trim().min(8).max(256);

export const twilioSettingsSchema = z.object({
  accountSid: z.string().trim().max(64).optional().default(""),
  authToken: z.string().max(256).optional().default(""),
  fromNumber: z.string().trim().min(1).max(64),
});

export const twilioNotificationSchema = z.object({
  userId: z.string().uuid().optional(),
  handle: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{1,31}$/).optional(),
  message: z.string().trim().min(1).max(1_600),
  mediaUrls: z.array(z.string().url().startsWith("https://")).max(10).default([]),
}).refine((value) => Boolean(value.userId) !== Boolean(value.handle), {
  message: "Provide exactly one workspace user id or handle",
});

type StoredConnection = {
  enabled: boolean;
  public_config: { accountSid?: string; fromNumber?: string };
  encrypted_credentials: string | null;
  revision: string;
  applied_revision: string | null;
  apply_error: string | null;
  source: "settings" | "environment";
  updated_at: Date;
};

type TwilioSecret = { authToken: string };

export type TwilioPluginStatus = {
  id: "twilio-sms";
  name: "Twilio SMS/MMS";
  description: string;
  type: "channel";
  scope: "global";
  ownership: "workspace";
  editable: boolean;
  ready: boolean;
  configured: boolean;
  source: "settings" | "environment" | null;
  accountSidHint: string | null;
  fromNumber: string | null;
  webhookUrl: string;
  webhookMethod: "POST";
  webhookVerified: boolean | null;
  smsCapable: boolean | null;
  mmsCapable: boolean | null;
  revision: number | null;
  appliedRevision: number | null;
  error: string | null;
};

function basicAuthorization(config: SmsConfig): string {
  return `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`;
}

function accountHint(accountSid: string): string {
  return `${accountSid.slice(0, 4)}••••••••${accountSid.slice(-4)}`;
}

export class TwilioPluginService implements VerificationSmsTransport {
  constructor(
    private readonly pool: Pool,
    private readonly cipher: CredentialCipher,
    private readonly environmentConfig?: SmsConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async stored(): Promise<StoredConnection | undefined> {
    return (await this.pool.query<StoredConnection>(
      "SELECT * FROM plugin_connections WHERE plugin_id = $1",
      [PLUGIN_ID],
    )).rows[0];
  }

  async effectiveConfig(): Promise<{ config: SmsConfig; source: "settings" | "environment"; row?: StoredConnection } | undefined> {
    const row = await this.stored();
    if (row) {
      if (!row.enabled || !row.encrypted_credentials) return undefined;
      const accountSid = row.public_config.accountSid;
      const fromNumber = row.public_config.fromNumber;
      if (!accountSid || !fromNumber) return undefined;
      const secret = this.cipher.decrypt<TwilioSecret>(row.encrypted_credentials);
      return { config: { accountSid, fromNumber, authToken: secret.authToken }, source: "settings", row };
    }
    return this.environmentConfig
      ? { config: this.environmentConfig, source: "environment" }
      : undefined;
  }

  available = async (): Promise<boolean> => Boolean(await this.effectiveConfig());

  private async createMessage(to: string, body: string, mediaUrls: string[] = []): Promise<void> {
    const effective = await this.effectiveConfig();
    if (!effective) {
      throw new PhoneError(503, "sms_not_configured", "Twilio SMS/MMS is not configured. Contact your administrator.");
    }
    const { config } = effective;
    const form = new URLSearchParams({ To: to, From: config.fromNumber, Body: body });
    for (const mediaUrl of mediaUrls) form.append("MediaUrl", mediaUrl);
    try {
      const result = await this.fetchFn(
        `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: basicAuthorization(config),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form,
          signal: AbortSignal.timeout(10_000),
        },
      );
      const payload = await result.json() as { sid?: string; status?: string };
      if (!result.ok || !payload.sid || ["failed", "undelivered", "canceled"].includes(payload.status ?? "")) {
        throw new Error("Twilio rejected the message");
      }
    } catch {
      throw new PhoneError(503, "sms_unavailable", "The SMS/MMS message could not be sent. Try again later.");
    }
  }

  async send(number: string, code: string): Promise<void> {
    await this.createMessage(
      number,
      `Your Neural Labs verification code is ${code}. Expires in 10 minutes. Do not share it. Reply STOP to opt out, HELP for help.`,
    );
  }

  private async inspect(config: SmsConfig, webhookUrl: string) {
    const url = new URL(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/IncomingPhoneNumbers.json`);
    url.searchParams.set("PhoneNumber", config.fromNumber);
    const result = await this.fetchFn(url, {
      headers: { Authorization: basicAuthorization(config), Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!result.ok) throw new PhoneError(422, "twilio_credentials_invalid", "Twilio could not validate those credentials and sender number.");
    const payload = await result.json() as { incoming_phone_numbers?: Array<{ phone_number?: string; sms_url?: string; sms_method?: string; capabilities?: { sms?: boolean; mms?: boolean } }> };
    const number = payload.incoming_phone_numbers?.find((entry) => entry.phone_number === config.fromNumber);
    if (!number) throw new PhoneError(422, "twilio_sender_invalid", "That sender number was not found in this Twilio account.");
    return {
      webhookVerified: number.sms_url === webhookUrl && (number.sms_method ?? "POST").toUpperCase() === "POST",
      smsCapable: number.capabilities?.sms ?? null,
      mmsCapable: number.capabilities?.mms ?? null,
    };
  }

  async status(webhookUrl: string, editable: boolean, probe = false): Promise<TwilioPluginStatus> {
    const effective = await this.effectiveConfig();
    let inspected: Awaited<ReturnType<TwilioPluginService["inspect"]>> | undefined;
    let error: string | null = effective?.row?.apply_error ?? null;
    if (effective && probe) {
      try { inspected = await this.inspect(effective.config, webhookUrl); }
      catch (cause) { error = cause instanceof Error ? cause.message : "Twilio validation failed."; }
    }
    return {
      id: PLUGIN_ID,
      name: "Twilio SMS/MMS",
      description: "Let verified workspace members message their private Neura and receive opted-in agent updates.",
      type: "channel",
      scope: "global",
      ownership: "workspace",
      editable,
      ready: Boolean(effective) && !error,
      configured: Boolean(effective),
      source: effective?.source ?? null,
      accountSidHint: effective ? accountHint(effective.config.accountSid) : null,
      fromNumber: effective?.config.fromNumber ?? null,
      webhookUrl,
      webhookMethod: "POST",
      webhookVerified: inspected?.webhookVerified ?? null,
      smsCapable: inspected?.smsCapable ?? null,
      mmsCapable: inspected?.mmsCapable ?? null,
      revision: effective?.row ? Number(effective.row.revision) : null,
      appliedRevision: effective?.row?.applied_revision ? Number(effective.row.applied_revision) : null,
      error,
    };
  }

  async save(input: z.infer<typeof twilioSettingsSchema>, webhookUrl: string): Promise<void> {
    const fromNumber = normalizePhone(input.fromNumber);
    const existing = await this.effectiveConfig();
    const parsedAccountSid = accountSidSchema.safeParse(input.accountSid.trim() || existing?.config.accountSid || "");
    const authToken = input.authToken.trim() || existing?.config.authToken || "";
    const parsedAuthToken = authTokenSchema.safeParse(authToken);
    if (!parsedAccountSid.success || !parsedAuthToken.success) {
      throw new PhoneError(422, "twilio_credentials_required", "Enter a valid Twilio Account SID and Auth Token.");
    }
    const config = { accountSid: parsedAccountSid.data, authToken: parsedAuthToken.data, fromNumber };
    const inspection = await this.inspect(config, webhookUrl);
    await this.pool.query(
      `INSERT INTO plugin_connections(plugin_id, enabled, public_config, encrypted_credentials, revision, applied_revision, apply_error, source)
       VALUES ($1, true, $2, $3, 1, NULL, NULL, 'settings')
       ON CONFLICT (plugin_id) DO UPDATE SET enabled = true, public_config = EXCLUDED.public_config,
         encrypted_credentials = EXCLUDED.encrypted_credentials, revision = plugin_connections.revision + 1,
         applied_revision = NULL, apply_error = NULL, source = 'settings', updated_at = now()`,
      [PLUGIN_ID, { accountSid: config.accountSid, fromNumber }, this.cipher.encrypt<TwilioSecret>({ authToken: config.authToken })],
    );
    if (inspection.smsCapable === false) {
      await this.pool.query("UPDATE plugin_connections SET apply_error = $2 WHERE plugin_id = $1", [PLUGIN_ID, "The selected Twilio number is not SMS capable."]);
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.query(
      `INSERT INTO plugin_connections(plugin_id, enabled, public_config, encrypted_credentials, source)
       VALUES ($1, false, '{}'::jsonb, NULL, 'settings')
       ON CONFLICT (plugin_id) DO UPDATE SET enabled = false, public_config = '{}'::jsonb,
         encrypted_credentials = NULL, revision = plugin_connections.revision + 1,
         applied_revision = NULL, apply_error = NULL, source = 'settings', updated_at = now()`,
      [PLUGIN_ID],
    );
  }

  async runtimeConfig(webhookUrl: string) {
    const effective = await this.effectiveConfig();
    if (!effective) return { enabled: false, revision: 0, webhookUrl, users: [] };
    const users = (await this.pool.query<{ id: string; handle: string; phone_number: string; notifications_enabled: boolean }>(
      `SELECT users.id, users.handle, user_phones.phone_number, user_phones.notifications_enabled
       FROM user_phones JOIN users ON users.id = user_phones.user_id
       WHERE user_phones.verified_at IS NOT NULL AND user_phones.phone_number IS NOT NULL AND users.status = 'active'
       ORDER BY users.id`,
    )).rows;
    return {
      enabled: true,
      revision: effective.row ? Number(effective.row.revision) : 1,
      webhookUrl,
      accountSid: effective.config.accountSid,
      authToken: effective.config.authToken,
      fromNumber: effective.config.fromNumber,
      users: users.map((user) => ({
        userId: user.id,
        handle: user.handle,
        phoneNumber: user.phone_number,
        notificationsEnabled: user.notifications_enabled,
      })),
    };
  }

  async sendNotification(input: z.infer<typeof twilioNotificationSchema>): Promise<{ recipient: string; mediaCount: number }> {
    const result = await this.pool.query<{ id: string; handle: string; phone_number: string }>(
      `SELECT users.id, users.handle, user_phones.phone_number
       FROM users JOIN user_phones ON user_phones.user_id = users.id
       WHERE users.status = 'active' AND user_phones.verified_at IS NOT NULL
         AND user_phones.notifications_enabled = true
         AND (($1::uuid IS NOT NULL AND users.id = $1) OR ($2::text IS NOT NULL AND lower(users.handle) = lower($2)))`,
      [input.userId ?? null, input.handle ?? null],
    );
    const recipient = result.rows[0];
    if (!recipient) {
      throw new PhoneError(403, "sms_recipient_not_allowed", "That workspace member has not enabled agent SMS notifications.");
    }
    await this.createMessage(recipient.phone_number, input.message, input.mediaUrls);
    await this.pool.query(
      "INSERT INTO audit_log(actor_user_id, action, target_user_id, metadata) VALUES (NULL, 'agent.sms_notification.sent', $1, $2)",
      [recipient.id, { mediaCount: input.mediaUrls.length }],
    );
    return { recipient: `@${recipient.handle}`, mediaCount: input.mediaUrls.length };
  }
}
