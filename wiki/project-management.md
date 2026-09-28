# Project Management app

The Projects application stores its records in the environment's PostgreSQL
volume. Open **Projects** from the desktop dock, or open
`/workspace?app=projects` after signing in to the instance.

Tasks, deliverables, notes, resources, tickets and replies share one project
service. Status edits use revisions; stale editors offer to load the current
record instead of silently overwriting another person's changes. The WebSocket
at `/api/projects/socket` invalidates both desktop and dedicated views and closes
when the signed-in member loses access.

## External connections

In Projects, expand **API & MCP connections**. Create a credential and copy it
before dismissing it. The token is shown once and stored only as a hash. The UI
creates a 30-day read/write credential; the key API also supports read-only scopes
and lifetimes from 1 to 90 days. Revoke unused credentials from the same panel.

- REST base: `https://YOUR-INSTANCE/api/projects`
- Streamable HTTP MCP: `https://YOUR-INSTANCE/api/projects/mcp`
- Authorization: `Bearer ENVIRONMENT-CREDENTIAL`
- Scopes: `project:read`, `project:write`

The MCP endpoint is for clients that support configuring bearer credentials. It
does not provide an OAuth authorization flow. Existing Microsoft MCP configuration
is separate. Credentials are bound to a local user; disabling that user prevents
further use. Managed deployments also recheck membership, API service coverage
and deployment generation. A generation change requires a new credential.

`GET /items` returns up to 100 visible records and a `next` cursor. Send it as
`?after=CURSOR` until `next` is null. Mutations require an `idempotency_key` UUID;
updates/actions also require the record's current `revision`. Read the record
again after a revision conflict before deciding whether to retry your edit.

A credential does not grant shell, file or billing access. Project connections do
not reuse a portal API key and do not forward project content to the portal.

## Managed rollout status

This app is a new local project service, not yet a drop-in replacement for an
existing portal board. Migration, custom statuses, publication rules, complete
resource/file workflows, embedded sign-in and protected-mode controls are still
pending. Existing managed workspaces must remain portal-backed until those paths
have been implemented and rehearsed. See [ADR 0038](adr/0038-environment-projects.md).
