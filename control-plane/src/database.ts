import { randomUUID } from "node:crypto";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { migrations } from "./migrations.js";
import type {
  IdentityRecord,
  McpRuntimeConfig,
  MicrosoftClaims,
  OidcTransaction,
  PasskeyChallenge,
  PasskeyRecord,
  SessionActor,
  SessionRecord,
  StoredInstanceConfig,
  UserRecord,
  UserRole,
  UserStatus,
} from "./types.js";
import { normalizeEmail } from "./crypto.js";

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  handle: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
}

interface IdentityRow extends QueryResultRow {
  id: string;
  user_id: string;
  provider: "local" | "microsoft";
  subject: string;
  tenant_id: string | null;
  username: string | null;
  password_hash: string | null;
  created_at: Date;
}

interface InstanceRow extends QueryResultRow {
  setup_complete: boolean;
  public_origin: string | null;
  local_auth_enabled: boolean;
  microsoft_auth_enabled: boolean;
  microsoft_mcp_enabled: boolean;
  entra_tenant_id: string | null;
  entra_client_id: string | null;
  entra_authority_host: string;
  encrypted_entra_credential: string | null;
  config_version: string;
  created_at: Date;
  updated_at: Date;
}

interface PasskeyRow extends QueryResultRow {
  id: string;
  user_id: string;
  credential_id: string;
  webauthn_user_id: string;
  public_key: Buffer;
  signature_counter: string;
  device_type: "singleDevice" | "multiDevice";
  backed_up: boolean;
  transports: string[];
  display_name: string;
  created_at: Date;
  last_used_at: Date | null;
}

interface PasskeyWithUserRow extends PasskeyRow {
  user_record_id: string;
  email: string;
  handle: string;
  user_display_name: string;
  role: UserRole;
  status: UserStatus;
  user_created_at: Date;
  user_updated_at: Date;
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    handle: row.handle,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapIdentity(row: IdentityRow): IdentityRecord {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    subject: row.subject,
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    ...(row.username ? { username: row.username } : {}),
    ...(row.password_hash ? { passwordHash: row.password_hash } : {}),
    createdAt: row.created_at,
  };
}

function mapInstance(row: InstanceRow): StoredInstanceConfig {
  return {
    setupComplete: row.setup_complete,
    ...(row.public_origin ? { publicOrigin: row.public_origin } : {}),
    localAuthEnabled: row.local_auth_enabled,
    microsoftAuthEnabled: row.microsoft_auth_enabled,
    microsoftMcpEnabled: row.microsoft_mcp_enabled,
    ...(row.entra_tenant_id ? { entraTenantId: row.entra_tenant_id } : {}),
    ...(row.entra_client_id ? { entraClientId: row.entra_client_id } : {}),
    entraAuthorityHost: row.entra_authority_host,
    ...(row.encrypted_entra_credential
      ? { encryptedEntraCredential: row.encrypted_entra_credential }
      : {}),
    configVersion: Number(row.config_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPasskey(row: PasskeyRow): PasskeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    credentialId: row.credential_id,
    webauthnUserId: row.webauthn_user_id,
    publicKey: new Uint8Array(row.public_key),
    counter: Number(row.signature_counter),
    deviceType: row.device_type,
    backedUp: row.backed_up,
    transports: row.transports,
    displayName: row.display_name,
    createdAt: row.created_at,
    ...(row.last_used_at ? { lastUsedAt: row.last_used_at } : {}),
  };
}

export interface SaveSetupInput {
  publicOrigin: string;
  localAuthEnabled: boolean;
  microsoftAuthEnabled: boolean;
  microsoftMcpEnabled: boolean;
  entraTenantId?: string;
  entraClientId?: string;
  entraAuthorityHost?: string;
  encryptedEntraCredential?: string;
}

export class Database {
  readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version integer PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      for (const migration of migrations) {
        const applied = await client.query<{ exists: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1) AS exists",
          [migration.version],
        );
        if (!applied.rows[0]?.exists) {
          await client.query(migration.sql);
          await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [migration.version]);
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async getInstanceConfig(): Promise<StoredInstanceConfig> {
    const result = await this.pool.query<InstanceRow>("SELECT * FROM instance_config WHERE singleton_id = 1");
    const row = result.rows[0];
    if (!row) throw new Error("Instance configuration row is missing");
    return mapInstance(row);
  }

  async saveSetup(input: SaveSetupInput): Promise<StoredInstanceConfig> {
    const result = await this.pool.query<InstanceRow>(
      `UPDATE instance_config
       SET setup_complete = true,
           public_origin = $1,
           local_auth_enabled = $2,
           microsoft_auth_enabled = $3,
           microsoft_mcp_enabled = $4,
           entra_tenant_id = $5,
           entra_client_id = $6,
           entra_authority_host = COALESCE($7, entra_authority_host),
           encrypted_entra_credential = $8,
           config_version = config_version + 1,
           updated_at = now()
       WHERE singleton_id = 1 AND setup_complete = false
       RETURNING *`,
      [
        input.publicOrigin,
        input.localAuthEnabled,
        input.microsoftAuthEnabled,
        input.microsoftMcpEnabled,
        input.entraTenantId ?? null,
        input.entraClientId ?? null,
        input.entraAuthorityHost ?? null,
        input.encryptedEntraCredential ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Setup has already been completed");
    return mapInstance(row);
  }

  async resetSetupIfUnclaimed(): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE instance_config SET setup_complete = false, updated_at = now()
       WHERE singleton_id = 1 AND NOT EXISTS (SELECT 1 FROM users)`,
    );
    return result.rowCount === 1;
  }

  async updateAuthSettings(input: {
    localAuthEnabled: boolean;
    microsoftAuthEnabled: boolean;
    microsoftMcpEnabled: boolean;
  }): Promise<StoredInstanceConfig> {
    const result = await this.pool.query<InstanceRow>(
      `UPDATE instance_config
       SET local_auth_enabled = $1,
           microsoft_auth_enabled = $2,
           microsoft_mcp_enabled = $3,
           config_version = config_version + 1,
           updated_at = now()
       WHERE singleton_id = 1
       RETURNING *`,
      [input.localAuthEnabled, input.microsoftAuthEnabled, input.microsoftMcpEnabled],
    );
    return mapInstance(result.rows[0]!);
  }

  async replaceEntraConfiguration(input: {
    tenantId: string;
    clientId: string;
    authorityHost: string;
    encryptedCredential: string;
    microsoftAuthEnabled: boolean;
    microsoftMcpEnabled: boolean;
  }): Promise<StoredInstanceConfig> {
    const result = await this.pool.query<InstanceRow>(
      `UPDATE instance_config
       SET entra_tenant_id = $1,
           entra_client_id = $2,
           entra_authority_host = $3,
           encrypted_entra_credential = $4,
           microsoft_auth_enabled = $5,
           microsoft_mcp_enabled = $6,
           config_version = config_version + 1,
           updated_at = now()
       WHERE singleton_id = 1
       RETURNING *`,
      [
        input.tenantId,
        input.clientId,
        input.authorityHost,
        input.encryptedCredential,
        input.microsoftAuthEnabled,
        input.microsoftMcpEnabled,
      ],
    );
    return mapInstance(result.rows[0]!);
  }

  private async createUserWithIdentity(
    client: PoolClient,
    input: {
      email: string;
      displayName: string;
      provider: "local" | "microsoft";
      subject: string;
      tenantId?: string;
      username?: string;
      passwordHash?: string;
      initialAdminEmail?: string;
    },
  ): Promise<UserRecord> {
    await client.query("SELECT pg_advisory_xact_lock(1313426514)");
    const adminResult = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM users WHERE role = 'admin' AND status = 'active'",
    );
    const normalized = normalizeEmail(input.email);
    const noActiveAdmin = Number(adminResult.rows[0]?.count ?? "0") === 0;
    const claimsAdmin =
      noActiveAdmin &&
      (!input.initialAdminEmail || normalized === normalizeEmail(input.initialAdminEmail));
    const userId = randomUUID();
    const role: UserRole = claimsAdmin ? "admin" : "user";
    const status: UserStatus = claimsAdmin ? "active" : "pending";
    const rawHandle = normalized.split("@")[0]!
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]/g, "")
      .replace(/^[^a-z0-9]+/, "");
    const baseHandle = (rawHandle.length >= 2 ? rawHandle : "user").slice(0, 28);
    let handle = baseHandle;
    let handleSuffix = 2;
    while (
      new Set(["neura", "everyone", "here", "system", "admin"]).has(handle) ||
      (await client.query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM users WHERE lower(handle) = lower($1)) AS exists", [handle])).rows[0]?.exists
    ) {
      const suffix = String(handleSuffix++);
      handle = `${baseHandle.slice(0, 32 - suffix.length)}${suffix}`;
    }
    const userResult = await client.query<UserRow>(
      `INSERT INTO users(id, email, normalized_email, handle, display_name, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, input.email.trim(), normalized, handle, input.displayName.trim(), role, status],
    );
    await client.query(
      `INSERT INTO identities(id, user_id, provider, subject, tenant_id, username, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        userId,
        input.provider,
        input.subject,
        input.tenantId ?? null,
        input.username ?? null,
        input.passwordHash ?? null,
      ],
    );
    await this.writeAudit(client, userId, "user.registered", userId, {
      provider: input.provider,
      claimsAdmin,
      status,
      role,
    });
    return mapUser(userResult.rows[0]!);
  }

  async createLocalUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
  }, initialAdminEmail?: string): Promise<UserRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const user = await this.createUserWithIdentity(client, {
        ...input,
        provider: "local",
        subject: normalizeEmail(input.email),
        ...(initialAdminEmail ? { initialAdminEmail } : {}),
      });
      await client.query("COMMIT");
      return user;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findLocalIdentity(email: string): Promise<{ user: UserRecord; identity: IdentityRecord } | undefined> {
    const result = await this.pool.query<UserRow & IdentityRow>(
      `SELECT u.*, i.id AS identity_id, i.user_id, i.provider, i.subject, i.tenant_id,
              i.username, i.password_hash, i.created_at AS identity_created_at
       FROM users u
       JOIN identities i ON i.user_id = u.id
       WHERE i.provider = 'local' AND i.subject = $1`,
      [normalizeEmail(email)],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      user: mapUser(row),
      identity: mapIdentity({
        id: row.identity_id,
        user_id: row.user_id,
        provider: row.provider,
        subject: row.subject,
        tenant_id: row.tenant_id,
        username: row.username,
        password_hash: row.password_hash,
        created_at: row.identity_created_at,
      }),
    };
  }

  async findOrCreateMicrosoftUser(
    claims: MicrosoftClaims,
    initialAdminEmail?: string,
  ): Promise<UserRecord> {
    const subject = `${claims.tenantId}:${claims.objectId ?? claims.subject}`;
    const existing = await this.pool.query<UserRow>(
      `SELECT u.* FROM users u
       JOIN identities i ON i.user_id = u.id
       WHERE i.provider = 'microsoft' AND i.subject = $1`,
      [subject],
    );
    if (existing.rows[0]) return mapUser(existing.rows[0]);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(1313426514)");
      const lockedExisting = await client.query<UserRow>(
        `SELECT u.* FROM users u
         JOIN identities i ON i.user_id = u.id
         WHERE i.provider = 'microsoft' AND i.subject = $1 FOR UPDATE OF u`,
        [subject],
      );
      const user = lockedExisting.rows[0]
        ? mapUser(lockedExisting.rows[0])
        : await this.createUserWithIdentity(client, {
            email: claims.email,
            displayName: claims.displayName,
            provider: "microsoft",
            subject,
            tenantId: claims.tenantId,
            ...(claims.username ? { username: claims.username } : {}),
            ...(initialAdminEmail ? { initialAdminEmail } : {}),
          });
      await client.query("COMMIT");
      return user;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async linkMicrosoftIdentity(userId: string, claims: MicrosoftClaims): Promise<void> {
    const subject = `${claims.tenantId}:${claims.objectId ?? claims.subject}`;
    await this.pool.query(
      `INSERT INTO identities(id, user_id, provider, subject, tenant_id, username)
       VALUES ($1, $2, 'microsoft', $3, $4, $5)`,
      [randomUUID(), userId, subject, claims.tenantId, claims.username ?? null],
    );
    await this.audit(userId, "identity.linked", userId, { provider: "microsoft" });
  }

  async addLocalIdentity(userId: string, email: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO identities(id, user_id, provider, subject, password_hash)
       VALUES ($1, $2, 'local', $3, $4)`,
      [randomUUID(), userId, normalizeEmail(email), passwordHash],
    );
    await this.audit(userId, "identity.linked", userId, { provider: "local" });
  }

  async listPasskeys(userId: string): Promise<PasskeyRecord[]> {
    const result = await this.pool.query<PasskeyRow>(
      "SELECT * FROM passkeys WHERE user_id = $1 ORDER BY created_at, id",
      [userId],
    );
    return result.rows.map(mapPasskey);
  }

  async findPasskeyByCredentialId(credentialId: string): Promise<{ passkey: PasskeyRecord; user: UserRecord } | undefined> {
    const result = await this.pool.query<PasskeyWithUserRow>(
      `SELECT p.*,
              u.id AS user_record_id,
              u.email,
              u.handle,
              u.display_name AS user_display_name,
              u.role,
              u.status,
              u.created_at AS user_created_at,
              u.updated_at AS user_updated_at
       FROM passkeys p
       JOIN users u ON u.id = p.user_id
       WHERE p.credential_id = $1`,
      [credentialId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      passkey: mapPasskey(row),
      user: mapUser({
        id: row.user_record_id,
        email: row.email,
        handle: row.handle,
        display_name: row.user_display_name,
        role: row.role,
        status: row.status,
        created_at: row.user_created_at,
        updated_at: row.user_updated_at,
      }),
    };
  }

  async createPasskey(input: Omit<PasskeyRecord, "id" | "createdAt" | "lastUsedAt">): Promise<PasskeyRecord> {
    const result = await this.pool.query<PasskeyRow>(
      `INSERT INTO passkeys(
         id, user_id, credential_id, webauthn_user_id, public_key, signature_counter,
         device_type, backed_up, transports, display_name
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        randomUUID(), input.userId, input.credentialId, input.webauthnUserId,
        Buffer.from(input.publicKey), input.counter, input.deviceType, input.backedUp,
        input.transports, input.displayName,
      ],
    );
    return mapPasskey(result.rows[0]!);
  }

  async updatePasskeyUsage(id: string, counter: number, backedUp: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE passkeys
       SET signature_counter = GREATEST(signature_counter, $2), backed_up = backed_up OR $3, last_used_at = now()
       WHERE id = $1`,
      [id, counter, backedUp],
    );
  }

  async deletePasskey(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM passkeys WHERE id = $1 AND user_id = $2", [id, userId]);
    return result.rowCount === 1;
  }

  async savePasskeyChallenge(challenge: PasskeyChallenge): Promise<void> {
    await this.pool.query("DELETE FROM passkey_challenges WHERE expires_at <= now()");
    await this.pool.query(
      `INSERT INTO passkey_challenges(token_hash, challenge, kind, user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [challenge.tokenHash, challenge.challenge, challenge.kind, challenge.userId ?? null, challenge.expiresAt],
    );
  }

  async consumePasskeyChallenge(
    tokenHash: string,
    kind: PasskeyChallenge["kind"],
    userId?: string,
  ): Promise<PasskeyChallenge | undefined> {
    const result = await this.pool.query<QueryResultRow & {
      token_hash: string;
      challenge: string;
      kind: PasskeyChallenge["kind"];
      user_id: string | null;
      expires_at: Date;
    }>(
      `DELETE FROM passkey_challenges
       WHERE token_hash = $1 AND kind = $2 AND user_id IS NOT DISTINCT FROM $3 AND expires_at > now()
       RETURNING *`,
      [tokenHash, kind, userId ?? null],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      tokenHash: row.token_hash,
      challenge: row.challenge,
      kind: row.kind,
      ...(row.user_id ? { userId: row.user_id } : {}),
      expiresAt: row.expires_at,
    };
  }

  async createSession(input: {
    tokenHash: string;
    csrfHash: string;
    userId: string;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions(token_hash, csrf_hash, user_id, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.tokenHash, input.csrfHash, input.userId, input.idleExpiresAt, input.absoluteExpiresAt],
    );
  }

  async getSessionActor(tokenHash: string): Promise<SessionActor | undefined> {
    const sessionResult = await this.pool.query<
      QueryResultRow & {
        token_hash: string;
        user_id: string;
        csrf_hash: string;
        idle_expires_at: Date;
        absolute_expires_at: Date;
        created_at: Date;
        last_seen_at: Date;
      }
    >(
      `SELECT * FROM sessions
       WHERE token_hash = $1 AND idle_expires_at > now() AND absolute_expires_at > now()`,
      [tokenHash],
    );
    const sessionRow = sessionResult.rows[0];
    if (!sessionRow) return undefined;

    const userResult = await this.pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [
      sessionRow.user_id,
    ]);
    const userRow = userResult.rows[0];
    if (!userRow) return undefined;
    const identityResult = await this.pool.query<IdentityRow>(
      "SELECT * FROM identities WHERE user_id = $1 ORDER BY created_at",
      [sessionRow.user_id],
    );
    return {
      user: mapUser(userRow),
      session: {
        tokenHash: sessionRow.token_hash,
        userId: sessionRow.user_id,
        csrfHash: sessionRow.csrf_hash,
        idleExpiresAt: sessionRow.idle_expires_at,
        absoluteExpiresAt: sessionRow.absolute_expires_at,
        createdAt: sessionRow.created_at,
        lastSeenAt: sessionRow.last_seen_at,
      },
      identities: identityResult.rows.map(mapIdentity),
    };
  }

  async touchSession(tokenHash: string, idleExpiresAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET idle_expires_at = LEAST($2, absolute_expires_at), last_seen_at = now()
       WHERE token_hash = $1`,
      [tokenHash, idleExpiresAt],
    );
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  }

  async saveOidcTransaction(transaction: OidcTransaction): Promise<void> {
    await this.pool.query(
      `INSERT INTO oidc_transactions(state_hash, nonce, code_verifier, intent, session_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        transaction.stateHash,
        transaction.nonce,
        transaction.codeVerifier,
        transaction.intent,
        transaction.sessionUserId ?? null,
        transaction.expiresAt,
      ],
    );
  }

  async consumeOidcTransaction(stateHash: string): Promise<OidcTransaction | undefined> {
    const result = await this.pool.query<
      QueryResultRow & {
        state_hash: string;
        nonce: string;
        code_verifier: string;
        intent: "login" | "link";
        session_user_id: string | null;
        expires_at: Date;
      }
    >(
      `DELETE FROM oidc_transactions
       WHERE state_hash = $1 AND expires_at > now()
       RETURNING *`,
      [stateHash],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      stateHash: row.state_hash,
      nonce: row.nonce,
      codeVerifier: row.code_verifier,
      intent: row.intent,
      ...(row.session_user_id ? { sessionUserId: row.session_user_id } : {}),
      expiresAt: row.expires_at,
    };
  }

  async consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const result = await this.pool.query<{ attempts: number }>(
      `INSERT INTO auth_rate_limits(rate_key, window_started_at, attempts)
       VALUES ($1, now(), 1)
       ON CONFLICT (rate_key) DO UPDATE SET
         window_started_at = CASE
           WHEN auth_rate_limits.window_started_at < now() - ($2 * interval '1 second') THEN now()
           ELSE auth_rate_limits.window_started_at
         END,
         attempts = CASE
           WHEN auth_rate_limits.window_started_at < now() - ($2 * interval '1 second') THEN 1
           ELSE auth_rate_limits.attempts + 1
         END
       RETURNING attempts`,
      [key, windowSeconds],
    );
    return (result.rows[0]?.attempts ?? limit + 1) <= limit;
  }

  async listUsers(): Promise<Array<UserRecord & { identities: IdentityRecord[] }>> {
    const users = await this.pool.query<UserRow>("SELECT * FROM users ORDER BY created_at");
    const identities = await this.pool.query<IdentityRow>("SELECT * FROM identities ORDER BY created_at");
    return users.rows.map((row) => ({
      ...mapUser(row),
      identities: identities.rows.filter((identity) => identity.user_id === row.id).map(mapIdentity),
    }));
  }

  async updateHandle(userId: string, handle: string): Promise<UserRecord | undefined> {
    const result = await this.pool.query<UserRow>(
      `UPDATE users SET handle = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [userId, handle],
    );
    if (!result.rows[0]) return undefined;
    await this.audit(userId, "user.handle_changed", userId, { handle });
    return mapUser(result.rows[0]);
  }

  async findActiveUserByMicrosoftIdentity(tenantId: string, subject: string, objectId?: string): Promise<UserRecord | undefined> {
    const candidates = [`${tenantId}:${objectId ?? subject}`, `${tenantId}:${subject}`];
    const result = await this.pool.query<UserRow>(
      `SELECT u.* FROM users u
       JOIN identities i ON i.user_id = u.id
       WHERE u.status = 'active' AND i.provider = 'microsoft' AND i.subject = ANY($1::text[])
       LIMIT 1`,
      [candidates],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : undefined;
  }

  async countActiveAdmins(excludeUserId?: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users
       WHERE role = 'admin' AND status = 'active' AND ($1::uuid IS NULL OR id <> $1)`,
      [excludeUserId ?? null],
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  async hasActiveAdminWithProvider(provider: "local" | "microsoft"): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM users u
         JOIN identities i ON i.user_id = u.id
         WHERE u.role = 'admin' AND u.status = 'active' AND i.provider = $1
       ) AS exists`,
      [provider],
    );
    return result.rows[0]?.exists ?? false;
  }

  async setUserState(
    actorUserId: string,
    targetUserId: string,
    input: { status?: UserStatus; role?: UserRole },
  ): Promise<UserRecord | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(1313426515)");
      const current = await client.query<UserRow>("SELECT * FROM users WHERE id = $1 FOR UPDATE", [
        targetUserId,
      ]);
      const currentRow = current.rows[0];
      if (!currentRow) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const removesActiveAdmin =
        currentRow.role === "admin" &&
        currentRow.status === "active" &&
        (input.role === "user" || (input.status !== undefined && input.status !== "active"));
      if (removesActiveAdmin) {
        const remaining = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM users
           WHERE role = 'admin' AND status = 'active' AND id <> $1`,
          [targetUserId],
        );
        if (Number(remaining.rows[0]?.count ?? "0") < 1) {
          throw new Error("At least one active administrator must remain");
        }
      }
      const result = await client.query<UserRow>(
        `UPDATE users SET
           status = COALESCE($2, status),
           role = COALESCE($3, role),
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [targetUserId, input.status ?? null, input.role ?? null],
      );
      await this.writeAudit(client, actorUserId, "user.state_changed", targetUserId, input);
      if (input.status && input.status !== "active") {
        await client.query("DELETE FROM sessions WHERE user_id = $1", [targetUserId]);
      }
      await client.query("COMMIT");
      return mapUser(result.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async writeAudit(
    client: PoolClient,
    actorUserId: string | null,
    action: string,
    targetUserId: string | null,
    metadata: object,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log(actor_user_id, action, target_user_id, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [actorUserId, action, targetUserId, JSON.stringify(metadata)],
    );
  }

  async audit(
    actorUserId: string | null,
    action: string,
    targetUserId: string | null,
    metadata: object = {},
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.writeAudit(client, actorUserId, action, targetUserId, metadata);
    } finally {
      client.release();
    }
  }

  async listAudit(limit = 100): Promise<
    Array<{
      id: string;
      actorUserId?: string;
      action: string;
      targetUserId?: string;
      metadata: unknown;
      createdAt: Date;
    }>
  > {
    const result = await this.pool.query<
      QueryResultRow & {
        id: string;
        actor_user_id: string | null;
        action: string;
        target_user_id: string | null;
        metadata: unknown;
        created_at: Date;
      }
    >("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1", [Math.min(limit, 500)]);
    return result.rows.map((row) => ({
      id: row.id,
      ...(row.actor_user_id ? { actorUserId: row.actor_user_id } : {}),
      action: row.action,
      ...(row.target_user_id ? { targetUserId: row.target_user_id } : {}),
      metadata: row.metadata,
      createdAt: row.created_at,
    }));
  }

  async getMcpRuntimeConfig(publicOrigin: string): Promise<McpRuntimeConfig | undefined> {
    const config = await this.getInstanceConfig();
    if (
      !config.setupComplete ||
      !config.microsoftMcpEnabled ||
      !config.entraTenantId ||
      !config.entraClientId
    ) {
      return undefined;
    }
    const publicUrl = new URL("/mcp", publicOrigin).toString();
    return {
      version: config.configVersion,
      tenantId: config.entraTenantId,
      clientId: config.entraClientId,
      authorityHost: config.entraAuthorityHost,
      publicUrl,
      oauthScope: `api://${config.entraClientId}/mcp.access`,
      requiredScope: "mcp.access",
      tokenAudience: config.entraClientId,
    };
  }
}
