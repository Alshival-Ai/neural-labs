# External projects and personal portal tools

Status: accepted. Supersedes the built-in Projects entry point in ADR 0050.

Tasks, notes, resources and their relationships live in an external project
application. Neural Labs retains its desktop, agents, Files, private history,
terminal, automations and provider connections. Projects is removed from the dock,
direct application entry point, ordinary HTTP routes and native agent tool catalog
on every installation. Existing PostgreSQL graph records are retained. Upgrading
must not delete graph tables or rewrite saved automation definitions.

Managed instances expose an Alshival.Ai connection immediately after portal
sign-in. A personal agent turn receives a local MCP URL and a revocable execution
capability. Only the control plane can decrypt that turn's originating portal
session; it exchanges requests against the registered portal. Every invocation
rechecks the execution lease, originating session, selected provider generation
and maintenance gate. Portal membership, scopes, service eligibility and rate
limits remain authoritative. Personal capabilities are not background grants.

Self-hosted instances offer an optional Alshival.Ai card under Settings → Plugins.
Public-client authorization uses HTTPS callbacks, PKCE, short-lived per-user state
and the portal MCP resource audience. Credentials are encrypted per user in the
control plane. Disconnect invalidates in-flight results and prevents an older
refresh or callback from restoring a revoked connection. Neither the browser nor
provider process receives portal refresh tokens.

Retired project routes return 410. Managed migration access remains limited to
signed snapshot reads and freeze/export/retire operations. A frozen source cannot
accept ordinary graph mutations. Raw item history, authors, custom statuses and
relationships remain available to an authorized migration. No migration may
silently choose between conflicting portal and runtime edits.

Before upgrading a self-hosted installation, stop graph and shared-file writers
and export with the previous database schema still intact:

```sh
npm --prefix control-plane run build
node bin/export-projects.mjs /private/project-export /absolute/shared-files-directory
```

Run with the installation's protected control-plane configuration. Select the
shared Files directory explicitly, not the whole runtime home or credential
folders. The destination must be new and outside the source. The command writes
owner-only JSONL records, copies regular files, excludes project API credentials,
and writes a checksum manifest last. Symlinks are rejected. A failed export is
incomplete; retry in a new directory after stopping writers. Original database
records and files remain in place. Retain the installation backup as well.

Automations that name retired project tools stop with an actionable review error.
Review their required external connection and authorization before enabling them
again; do not silently replace them with broad workspace access.
