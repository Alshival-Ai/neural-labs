export interface Migration {
  version: number;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS instance_config (
        singleton_id smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
        setup_complete boolean NOT NULL DEFAULT false,
        public_origin text,
        local_auth_enabled boolean NOT NULL DEFAULT true,
        microsoft_auth_enabled boolean NOT NULL DEFAULT false,
        microsoft_mcp_enabled boolean NOT NULL DEFAULT false,
        entra_tenant_id text,
        entra_client_id text,
        entra_authority_host text NOT NULL DEFAULT 'https://login.microsoftonline.com',
        encrypted_entra_credential text,
        config_version bigint NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      INSERT INTO instance_config (singleton_id)
      VALUES (1)
      ON CONFLICT (singleton_id) DO NOTHING;

      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY,
        email text NOT NULL,
        normalized_email text NOT NULL,
        display_name text NOT NULL,
        role text NOT NULL CHECK (role IN ('admin', 'user')),
        status text NOT NULL CHECK (status IN ('pending', 'active', 'rejected', 'disabled')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS users_normalized_email_idx ON users(normalized_email);

      CREATE TABLE IF NOT EXISTS identities (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider text NOT NULL CHECK (provider IN ('local', 'microsoft')),
        subject text NOT NULL,
        tenant_id text,
        username text,
        password_hash text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(provider, subject)
      );
      CREATE INDEX IF NOT EXISTS identities_user_id_idx ON identities(user_id);

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_hash text NOT NULL,
        idle_expires_at timestamptz NOT NULL,
        absolute_expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(idle_expires_at, absolute_expires_at);

      CREATE TABLE IF NOT EXISTS oidc_transactions (
        state_hash text PRIMARY KEY,
        nonce text NOT NULL,
        code_verifier text NOT NULL,
        intent text NOT NULL CHECK (intent IN ('login', 'link')),
        session_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS auth_rate_limits (
        rate_key text PRIMARY KEY,
        window_started_at timestamptz NOT NULL,
        attempts integer NOT NULL CHECK (attempts >= 0)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id bigserial PRIMARY KEY,
        actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        action text NOT NULL,
        target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at DESC);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS handle text;

      DO $$
      DECLARE
        account record;
        base_handle text;
        candidate text;
        suffix integer;
      BEGIN
        FOR account IN SELECT id, email FROM users WHERE handle IS NULL ORDER BY created_at, id LOOP
          base_handle := regexp_replace(
            lower(regexp_replace(split_part(account.email, '@', 1), '[^a-z0-9._-]', '', 'g')),
            '^[^a-z0-9]+',
            '',
            'g'
          );
          IF length(base_handle) < 2 THEN
            base_handle := 'user';
          END IF;
          base_handle := left(base_handle, 28);
          candidate := base_handle;
          suffix := 2;
          WHILE EXISTS (SELECT 1 FROM users WHERE lower(handle) = lower(candidate))
             OR candidate IN ('neura', 'everyone', 'here', 'system', 'admin') LOOP
            candidate := left(base_handle, 32 - length(suffix::text)) || suffix::text;
            suffix := suffix + 1;
          END LOOP;
          UPDATE users SET handle = candidate WHERE id = account.id;
        END LOOP;
      END $$;

      ALTER TABLE users ALTER COLUMN handle SET NOT NULL;
      ALTER TABLE users ADD CONSTRAINT users_handle_format_check
        CHECK (handle ~ '^[a-z0-9][a-z0-9._-]{1,31}$');
      CREATE UNIQUE INDEX IF NOT EXISTS users_handle_lower_idx ON users(lower(handle));

      CREATE TABLE IF NOT EXISTS team_channels (
        id uuid PRIMARY KEY,
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
        audience text NOT NULL CHECK (audience IN ('restricted', 'everyone')),
        owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        source_session_key text,
        pinned_at timestamptz,
        pinned_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(owner_user_id, source_session_key)
      );
      CREATE INDEX IF NOT EXISTS team_channels_activity_idx
        ON team_channels(pinned_at DESC NULLS LAST, updated_at DESC);

      CREATE TABLE IF NOT EXISTS team_channel_members (
        channel_id uuid NOT NULL REFERENCES team_channels(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        added_by uuid REFERENCES users(id) ON DELETE SET NULL,
        added_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(channel_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS team_channel_members_user_idx ON team_channel_members(user_id);

      CREATE TABLE IF NOT EXISTS team_messages (
        sequence bigserial PRIMARY KEY,
        id uuid NOT NULL UNIQUE,
        channel_id uuid NOT NULL REFERENCES team_channels(id) ON DELETE CASCADE,
        author_kind text NOT NULL CHECK (author_kind IN ('user', 'neura', 'system', 'imported_user', 'imported_neura')),
        author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 32000),
        attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
        client_request_id uuid,
        agent_run_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(author_user_id, client_request_id)
      );
      CREATE INDEX IF NOT EXISTS team_messages_channel_sequence_idx
        ON team_messages(channel_id, sequence DESC);

      CREATE TABLE IF NOT EXISTS team_message_mentions (
        message_id uuid NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY(message_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS team_message_mentions_user_idx
        ON team_message_mentions(user_id, message_id);

      CREATE TABLE IF NOT EXISTS team_channel_reads (
        channel_id uuid NOT NULL REFERENCES team_channels(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_read_sequence bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(channel_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS team_agent_runs (
        id uuid PRIMARY KEY,
        channel_id uuid NOT NULL REFERENCES team_channels(id) ON DELETE CASCADE,
        trigger_message_id uuid NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE,
        requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
        capability_hash text NOT NULL UNIQUE,
        status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
        error text,
        expires_at timestamptz NOT NULL,
        started_at timestamptz,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS team_agent_runs_queue_idx
        ON team_agent_runs(status, created_at);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS team_socket_tickets (
        token_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS team_socket_tickets_expiry_idx
        ON team_socket_tickets(expires_at);
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE team_messages DROP CONSTRAINT IF EXISTS team_messages_body_check;
      ALTER TABLE team_messages ADD CONSTRAINT team_messages_body_check
        CHECK (char_length(body) BETWEEN 1 AND 131072);
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE team_agent_runs
        ADD COLUMN IF NOT EXISTS activities jsonb NOT NULL DEFAULT '[]'::jsonb;
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE IF NOT EXISTS passkeys (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credential_id text NOT NULL UNIQUE CHECK (char_length(credential_id) BETWEEN 1 AND 1024),
        webauthn_user_id text NOT NULL CHECK (char_length(webauthn_user_id) BETWEEN 1 AND 128),
        public_key bytea NOT NULL,
        signature_counter bigint NOT NULL DEFAULT 0 CHECK (signature_counter >= 0),
        device_type text NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
        backed_up boolean NOT NULL DEFAULT false,
        transports text[] NOT NULL DEFAULT '{}',
        display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS passkeys_user_id_idx ON passkeys(user_id, created_at);

      CREATE TABLE IF NOT EXISTS passkey_challenges (
        token_hash text PRIMARY KEY,
        challenge text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('registration', 'authentication')),
        user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((kind = 'registration' AND user_id IS NOT NULL) OR kind = 'authentication')
      );
      CREATE INDEX IF NOT EXISTS passkey_challenges_expiry_idx ON passkey_challenges(expires_at);
    `,
  },
];
