# 0038 — Environment-local project content

Project content belongs to the deployment's PostgreSQL and persistent file volumes.
The browser, desktop and external API/MCP clients use the same project service.
The revision WebSocket contains invalidations, not a second content database.
Each mutation is serialized, revision checked and deduplicated per actor/request ID.
Task relationships are stored as workspace-local directed edges in PostgreSQL.
`depends_on` edges reject cycles; `related` edges have canonical symmetric identity.
Both endpoints must pass the same item visibility checks as ordinary project reads.
Dependencies warn in the UI but do not block status changes or review actions.
Checklists live on task records, while task-attached sticky notes remain separate
note records so each can keep its own author, shared position and history.

Shared task comments are also written into the installation's primary team channel in
the same database transaction. All graph content is shared within the workspace; legacy internal task content is removed before this model becomes active. Existing task comments are not replayed into the fresh channel. Replying to such a channel message creates a
comment on its original task. Ordinary channel messages remain chat messages.
The channel and project database work without any managed portal connection;
private agent conversations are separate.

The project service is generic. It does not contain Alshival billing tiers or
provisioning policy. Optional managed identity uses the existing identity adapter;
standalone deployments retain local identity. External credentials are hashed,
user-bound, scoped, revocable and expire in at most 90 days. They do not authorize
access to any other deployment. HTTP requests and WebSockets recheck membership.
The optional sync scope is issued only to a current project administrator (or a
managed portal project manager) and loses authority when that role is revoked.

## Optional mirror and runtime read boundary

The native graph is complete without a mirror. Snapshot v2 exposes revisions, stable IDs, tombstones and custom statuses to a scoped integration. Concurrent edits require the integration to review conflicts; absence alone is never a deletion. A portal’s paid-plan gates and storage policy stay outside this repository.

The trusted native runtime exposes a read-only graph tool through its per-turn MCP capability. Its callback binds the execution actor, revalidates before and after the read, and calls a service-authenticated control-plane endpoint that independently checks current membership. Provider processes never receive the control-plane token. The project-management template publishes paused with read-only execution; it produces proposals rather than graph writes.

Full resource/file transfer and the older protected-residency cutover remain separate, gated operations. Installing a graph or optional mirror does not establish protected-data compliance or backup verification.
