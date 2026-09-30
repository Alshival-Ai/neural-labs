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
  {
    version: 7,
    sql: `
      CREATE TABLE user_phones (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        phone_number text UNIQUE CHECK (phone_number ~ '^\\+[1-9][0-9]{7,14}$'),
        verified_at timestamptz,
        pending_number text CHECK (pending_number ~ '^\\+[1-9][0-9]{7,14}$'),
        challenge_id uuid,
        code_hash text,
        expires_at timestamptz,
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
        sent_at timestamptz,
        delivery_accepted boolean NOT NULL DEFAULT false,
        CHECK ((phone_number IS NULL) = (verified_at IS NULL))
      );
    `,
  },
  {
    version: 8,
    sql: `
      CREATE TABLE model_provider_policies (
        policy_key text PRIMARY KEY,
        user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
        policy jsonb NOT NULL,
        resolved jsonb,
        applied_revision bigint,
        apply_error text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((user_id IS NULL AND policy_key IN ('workspace:background', 'workspace:team')) OR (user_id IS NOT NULL AND policy_key = 'user:' || user_id::text))
      );
      ALTER TABLE team_agent_runs ADD COLUMN model_settings jsonb;
      CREATE TABLE model_provider_voice (
        singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
        revision bigint NOT NULL DEFAULT 1,
        settings jsonb NOT NULL,
        applied_revision bigint,
        apply_error text,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    version: 9,
    sql: `
      CREATE TABLE plugin_connections (
        plugin_id text PRIMARY KEY,
        scope text NOT NULL DEFAULT 'global' CHECK (scope = 'global'),
        enabled boolean NOT NULL DEFAULT true,
        public_config jsonb NOT NULL DEFAULT '{}'::jsonb,
        encrypted_credentials text,
        revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
        applied_revision bigint,
        apply_error text,
        source text NOT NULL DEFAULT 'settings' CHECK (source IN ('settings', 'environment')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE user_phones
        ADD COLUMN notifications_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
      CREATE INDEX user_phones_verified_idx
        ON user_phones(phone_number) WHERE verified_at IS NOT NULL;
    `,
  },
  {
    version: 10,
    sql: `
      ALTER TABLE team_messages DROP CONSTRAINT team_messages_body_check;
      ALTER TABLE team_messages ADD CONSTRAINT team_messages_body_check
        CHECK (char_length(body) BETWEEN 0 AND 32000);
      ALTER TABLE team_messages ADD CONSTRAINT team_messages_content_check
        CHECK (char_length(body) > 0 OR jsonb_array_length(attachments) > 0);
    `,
  },
  {
    version: 11,
    sql: `
      CREATE TABLE notification_preferences (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        session_key text,
        neura boolean NOT NULL DEFAULT true,
        email boolean NOT NULL DEFAULT false,
        defaults text[] NOT NULL DEFAULT ARRAY['neura'],
        read_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE automation_subscriptions (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id text NOT NULL,
        events text[] NOT NULL,
        channels text[] NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(user_id,job_id)
      );
      CREATE TABLE notification_config (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        sender_id text,
        sender_address text,
        email_enabled boolean NOT NULL DEFAULT false,
        reconcile_after bigint NOT NULL DEFAULT (extract(epoch FROM now())*1000)::bigint
      );
      INSERT INTO notification_config(singleton) VALUES(true);
      CREATE TABLE notification_run_summaries (
        job_id text NOT NULL, run_id text NOT NULL, content jsonb NOT NULL,
        PRIMARY KEY(job_id,run_id)
      );
      CREATE TABLE notification_events (
        id uuid PRIMARY KEY,
        event_key text UNIQUE NOT NULL,
        job_id text,
        run_id text,
        outcome text NOT NULL,
        title text NOT NULL,
        message text NOT NULL,
        links jsonb NOT NULL DEFAULT '[]',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE notification_deliveries (
        event_id uuid NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel text NOT NULL CHECK(channel IN ('neura','sms','email')),
        status text NOT NULL DEFAULT 'pending',
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        error_code text,
        PRIMARY KEY(event_id,user_id,channel)
      );
      CREATE INDEX notification_pending ON notification_deliveries(next_attempt_at) WHERE status='pending';
    `,
  },
  {
    version: 12,
    sql: `
      CREATE TABLE update_policy (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        revision bigint NOT NULL DEFAULT 1,
        policy jsonb NOT NULL
      );
      CREATE TABLE update_jobs (
        id uuid PRIMARY KEY,
        kind text NOT NULL CHECK(kind IN ('check','install','automatic')),
        phase text NOT NULL,
        message text NOT NULL DEFAULT '',
        release_id text,
        actor_id uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE update_runtime (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        gate boolean NOT NULL DEFAULT false,
        active_job uuid REFERENCES update_jobs(id),
        available jsonb,
        installed jsonb,
        codex jsonb,
        heartbeat timestamptz,
        checked_at timestamptz,
        error text
      );
      INSERT INTO update_runtime(singleton) VALUES(true);
    `,
  },
  {
    version: 13,
    sql: `CREATE TABLE deployment_identity (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), binding jsonb NOT NULL);
      ALTER TABLE sessions ADD COLUMN portal_grant text;
      CREATE TABLE managed_identities (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        issuer text NOT NULL, workspace uuid NOT NULL, subject text NOT NULL,
        UNIQUE(issuer, workspace, subject)
      );`,
  },
  {
    version: 14,
    sql: `
      CREATE TABLE project_storage (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','importing','frozen','exported')),
        revision bigint NOT NULL DEFAULT 1,
        migration_id uuid,
        manifest_hash text
      );
      INSERT INTO project_storage(singleton) VALUES(true);
      CREATE TABLE project_items (
        id uuid PRIMARY KEY, kind text NOT NULL,
        revision integer NOT NULL DEFAULT 1,
        data jsonb NOT NULL,
        author_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX project_parent ON project_items((data->>'parent_id'));
      CREATE TABLE project_requests (
        actor_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL,
        fingerprint text NOT NULL, item_id uuid NOT NULL REFERENCES project_items(id),
        PRIMARY KEY(actor_id,request_id)
      );
      CREATE TABLE project_events (
        sequence bigserial PRIMARY KEY, item_id uuid NOT NULL REFERENCES project_items(id),
        actor_id uuid NOT NULL REFERENCES users(id), operation text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE project_api_keys (
        id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
        name text NOT NULL, scopes jsonb NOT NULL, expires_at timestamptz NOT NULL,
        authority_generation integer NOT NULL DEFAULT 0,
        revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    version: 15,
    sql: `ALTER TABLE team_channels ADD COLUMN import_source text UNIQUE;`,
  },
  {
    version: 16,
    sql: `CREATE TABLE project_transfers (
      id uuid PRIMARY KEY, generation integer NOT NULL, manifest text NOT NULL,
      expected_count integer NOT NULL, state text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE project_transfer_records (
      transfer_id uuid NOT NULL REFERENCES project_transfers(id), key text NOT NULL,
      payload jsonb NOT NULL, digest text NOT NULL, PRIMARY KEY(transfer_id,key)
    );
    CREATE TABLE project_archive (key text PRIMARY KEY,payload jsonb NOT NULL,digest text NOT NULL);`,
  },
  {
    version: 17,
    sql: `CREATE TABLE native_connections (
      id uuid PRIMARY KEY, scope text NOT NULL CHECK(scope IN ('personal','shared','team','background')),
      user_id uuid REFERENCES users(id), provider text NOT NULL CHECK(provider IN ('codex','claude')),
      method text NOT NULL CHECK(method IN ('subscription','api-key')),
      label text NOT NULL, enabled boolean NOT NULL DEFAULT true, generation integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK((scope='personal') = (user_id IS NOT NULL))
    );
    CREATE UNIQUE INDEX native_connection_owner ON native_connections(scope,COALESCE(user_id::text,''),provider,method);
    CREATE TABLE native_execution_leases (
      id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id),
      session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
      connection_id uuid NOT NULL REFERENCES native_connections(id), generation integer NOT NULL,
      model text NOT NULL, purpose text NOT NULL, expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX native_lease_expiry ON native_execution_leases(expires_at);`,
  },
  {
    version: 18,
    sql: `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM update_runtime WHERE active_job IS NOT NULL)
          OR (EXISTS (SELECT 1 FROM update_runtime WHERE gate) AND NOT COALESCE((
            SELECT action='updates.native_managed_operator_started'
              AND metadata->>'release' ~ '^[a-f0-9]{40}$'
              AND metadata->>'workspace' ~ '^[a-f0-9-]{36}$'
              AND metadata->>'runtime' ~ '^[a-f0-9-]{36}$'
            FROM audit_log WHERE action LIKE 'updates.%' ORDER BY id DESC LIMIT 1
          ),false)) THEN
          RAISE EXCEPTION 'Finish the active workspace update or recovery before native migration';
        END IF;
      END $$;
      INSERT INTO audit_log(action,metadata)
        SELECT 'updates.native_policy_migration', jsonb_build_object('revision',revision,'policy',policy)
        FROM update_policy;
      -- Keep the original policy readable by the retained pre-cutover control
      -- plane. Native preferences have their own table; rollback never rewinds
      -- the database or overwrites accepted notification/subscription records.
      CREATE TABLE native_update_policy (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        revision bigint NOT NULL DEFAULT 1, policy jsonb NOT NULL
      );
      INSERT INTO native_update_policy(singleton,revision,policy)
        SELECT singleton,revision,(policy - 'openclawAutomatic' - 'codexAutomatic') ||
          jsonb_build_object('runtimeAutomatic',COALESCE(policy->'openclawAutomatic','false'::jsonb))
        FROM update_policy;
      INSERT INTO audit_log(action,metadata)
        SELECT 'updates.retained_legacy_runtime', jsonb_build_object('available',available,'installed',installed,'codex',codex)
        FROM update_runtime WHERE available IS NOT NULL OR installed IS NOT NULL OR codex IS NOT NULL;
      UPDATE update_runtime SET available=NULL,installed=NULL,codex=NULL,heartbeat=NULL,checked_at=NULL;
    `,
  },
  {
    version: 19,
    sql: `CREATE TABLE native_chat_defaults (
      selection_key text PRIMARY KEY,
      user_id uuid REFERENCES users(id) ON DELETE CASCADE,
      connection_id uuid NOT NULL REFERENCES native_connections(id),
      connection_generation integer NOT NULL CHECK(connection_generation > 0),
      model text NOT NULL CHECK(length(model) BETWEEN 1 AND 160),
      revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((selection_key = 'workspace:team' AND user_id IS NULL)
        OR (user_id IS NOT NULL AND selection_key = 'user:' || user_id::text))
    );`,
  },
  {
    version: 20,
    sql: `CREATE TABLE project_edges (
      id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES project_items(id) ON DELETE CASCADE,
      target_id uuid NOT NULL REFERENCES project_items(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK(kind IN ('depends_on','related')),
      actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
      CHECK(source_id <> target_id), UNIQUE(source_id,target_id,kind)
    );
    CREATE INDEX project_edges_target ON project_edges(target_id);
    CREATE TABLE project_edge_requests (
      actor_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL,
      fingerprint text NOT NULL, edge_id uuid REFERENCES project_edges(id) ON DELETE SET NULL,
      PRIMARY KEY(actor_id,request_id)
    );`,
  },
  {
    version: 21,
    sql: `ALTER TABLE team_messages ADD COLUMN project_item_id uuid UNIQUE REFERENCES project_items(id) ON DELETE SET NULL;
    CREATE INDEX team_messages_project_item_idx ON team_messages(project_item_id) WHERE project_item_id IS NOT NULL;
    INSERT INTO team_channels(id,name,audience,owner_user_id,import_source)
      SELECT gen_random_uuid(),'Team channel','everyone',id,'workspace:primary'
      FROM users ORDER BY (status='active') DESC,(role='admin') DESC,created_at LIMIT 1
      ON CONFLICT(import_source) DO NOTHING;
    INSERT INTO team_messages(id,channel_id,author_kind,author_user_id,body,project_item_id,created_at)
      SELECT gen_random_uuid(),channel.id,'user',item.author_id,item.data->>'body',item.id,item.created_at
      FROM project_items item JOIN project_items parent ON parent.id=(item.data->>'parent_id')::uuid
        AND parent.kind='task' AND parent.data->>'visibility'='shared' AND parent.data->>'deleted'!='true'
        AND (parent.data->'publication' IS NULL OR parent.data->'publication'='null'::jsonb
          OR parent.data->'publication'->>'published'='true')
      CROSS JOIN team_channels channel
      WHERE item.kind='comment' AND item.data->>'visibility'='shared' AND item.data->>'deleted'!='true'
        AND channel.import_source='workspace:primary'
        AND char_length(item.data->>'body') BETWEEN 1 AND 32000
      ON CONFLICT(project_item_id) DO NOTHING;`,
  },
  {
    version: 22,
    sql: `
      -- Intentional one-time reset. Upgrades must retain their pre-upgrade backup.
      INSERT INTO audit_log(action,metadata) SELECT 'projects.shared_workspace_migration',
        jsonb_build_object('channels_removed',(SELECT count(*) FROM team_channels),
          'messages_removed',(SELECT count(*) FROM team_messages));
      DELETE FROM team_channels;
      DELETE FROM team_socket_tickets;
      CREATE TEMP TABLE removed_project_items ON COMMIT DROP AS
        WITH RECURSIVE removed(id) AS (
          SELECT id FROM project_items WHERE
            data->>'visibility'='internal' OR data->'publication'->>'published'='false'
          UNION SELECT child.id FROM project_items child JOIN removed parent
            ON child.data->>'parent_id'=parent.id::text
        ) SELECT item.id FROM project_items item JOIN removed USING(id)
          WHERE item.kind IN ('task','note','comment');
      INSERT INTO audit_log(action,metadata) SELECT 'projects.internal_content_removed',
        jsonb_build_object('items_removed',count(*)) FROM removed_project_items;
      DELETE FROM project_requests WHERE item_id IN (SELECT id FROM removed_project_items);
      DELETE FROM project_events WHERE item_id IN (SELECT id FROM removed_project_items);
      DELETE FROM project_items WHERE id IN (SELECT id FROM removed_project_items);
      UPDATE project_items SET data=data || jsonb_build_object(
        'title',data->'publication'->>'title','body',data->'publication'->>'body',
        'acceptance','','details','{}'::jsonb,'references','{}'::jsonb,'reviewer',NULL)
        WHERE kind='task' AND data->'publication'->>'published'='true';
      UPDATE project_items SET data=jsonb_set(data,'{publication}','null'::jsonb)
        WHERE kind IN ('task','note','comment');
      ALTER TABLE project_items ADD CONSTRAINT shared_project_graph CHECK (
        kind NOT IN ('task','note','comment') OR
        (data->>'visibility'='shared' AND (data->'publication' IS NULL OR data->'publication'='null'::jsonb)));
      ALTER TABLE project_storage ADD COLUMN channel_history_started_at timestamptz NOT NULL DEFAULT now();
      UPDATE project_storage SET revision=revision+1;
      INSERT INTO team_channels(id,name,audience,owner_user_id,import_source)
        SELECT gen_random_uuid(),'Team channel','everyone',id,'workspace:primary'
        FROM users ORDER BY (status='active') DESC,(role='admin') DESC,created_at LIMIT 1;
      ALTER TABLE team_channels ADD CONSTRAINT workspace_primary_channel CHECK (
        audience='everyone' AND import_source IS NOT DISTINCT FROM 'workspace:primary');
    `,
  },
  {
    version: 23,
    sql: `CREATE TABLE project_statuses (
      id uuid PRIMARY KEY, revision integer NOT NULL DEFAULT 1,
      name text NOT NULL CHECK(length(name) BETWEEN 1 AND 60), color text NOT NULL DEFAULT 'blue',
      category text NOT NULL CHECK(category IN ('todo','doing','done')),
      legacy_state text NOT NULL DEFAULT '', position integer NOT NULL DEFAULT 0,
      is_default boolean NOT NULL DEFAULT false, retired boolean NOT NULL DEFAULT false,
      replacement_id uuid REFERENCES project_statuses(id));
    CREATE UNIQUE INDEX project_status_legacy ON project_statuses(legacy_state) WHERE legacy_state<>'';
    INSERT INTO project_statuses(id,name,color,category,legacy_state,position,is_default)
      SELECT gen_random_uuid(),name,color,category,state,position,state='todo'
      FROM (VALUES ('todo','To do','blue','todo',0),('doing','In progress','purple','doing',1),
        ('waiting','Waiting','orange','doing',2),('review','Review','pink','doing',3),
        ('done','Done','green','done',4)) AS defaults(state,name,color,category,position);
    UPDATE project_items item SET data=jsonb_set(item.data,'{status_id}',to_jsonb(status.id::text)) FROM project_statuses status WHERE item.kind='task' AND status.legacy_state=item.data->>'state';
    ALTER TABLE project_edges ADD COLUMN deleted_at timestamptz;
    ALTER TABLE project_edges ADD COLUMN revision integer NOT NULL DEFAULT 1;
    UPDATE project_storage SET revision=revision+1;`,
  },
];
