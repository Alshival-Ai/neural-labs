# Workspace task graph

Projects is native to every Neural Labs installation, including open-source self-hosted deployments. Tasks, relationships, sticky notes, comments and status catalogs live in the installation’s existing PostgreSQL database. No separate graph server or portal account is required.

Open **Projects** from the desktop. The board and graph use the same tasks. Directed dependencies reject cycles; related links are symmetric. Dependencies show context without preventing status changes. Task checklists and task-attached sticky notes retain their own identities. Drag a sticky note or use Alt + arrow keys to move it; its position is saved for the workspace.

All tasks, notes and task comments are shared with current workspace members. There is no private task/publication switch. Administrators manage the status catalog, including names, colors, order, the default and retirement replacements. Retiring a status moves its tasks to an active replacement in the same reporting category. Done tasks remain editable; explicit review acceptance still requires a separate reviewer.

Each workspace has one Team Channel. New task comments also appear there in the same database transaction. Replying to a task message adds a comment to its task. Ordinary chat stays in the channel; mention `@Alshival` to invoke the agent. Private agent conversations remain separate.

## Optional integrations

Projects → API & MCP connections creates expiring, revocable user-bound credentials. Tokens appear once and are stored only as hashes. Ordinary keys support `project:read` and `project:write`; current project administrators can also issue `project:sync`. Role removal invalidates sync authority on the next request.

- REST: `https://YOUR-INSTANCE/api/projects`
- MCP: `https://YOUR-INSTANCE/api/projects/mcp`
- Authentication: `Authorization: Bearer CREDENTIAL`
- `/items` pages up to 100 records using `next` as the following `after` cursor.
- `/sync/snapshot` version 2 includes stable identities, tombstones, status catalogs and a graph revision. Discard snapshots whose revision changes between pages.
- Item updates require the observed revision and an idempotency UUID. Sync edge creation/restoration also requires `expected_revision`; edge deletion requires `revision`.

An optional integration can mirror the graph, but Neural Labs continues operating independently when it is disconnected. Billing, hosted plan eligibility and support policy belong to the integrating service. File, resource, service-ticket and billing migration are separate from task-graph sync.

## Project-management proposal template

Automations → Project management template opens **Alshival - Project Management**. It publishes paused with a 09:00 and 17:00 daily schedule in the selected timezone. Review the timezone, owner, connection and prompt before enabling. Runs use read-only execution and the `read_project_graph` tool; results are proposals with task IDs and revisions, for a member to apply manually. It does not automatically change tasks or notify external recipients.

## Upgrade from the legacy task and channel model

Migration 22 deletes all legacy Team Chat channels/messages on managed and self-hosted installations and creates one fresh everyone channel. Private agent conversations are unaffected. Legacy internal/unpublished task content and its task descendants are deleted. Published tasks retain their public text rather than exposing old staff text. Existing shared task comments remain on their tasks and are not backfilled into the fresh channel, including after comment edits or task restoration.

This is a destructive, one-time migration. Use the installation’s gated upgrade and recovery procedure with a verified pre-upgrade database copy. Do not downgrade over the migrated database or restore a copy over accepted new writes. Migration retries preserve messages created after the reset. Source publication alone does not upgrade an installation.
