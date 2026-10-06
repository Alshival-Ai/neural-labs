# Projects board, notes and timeline

Projects is native to every Neural Labs installation, including open-source self-hosted deployments. Tasks, relationships, sticky notes, resources, deliverables, comments and status catalogs live in the installation’s existing PostgreSQL database. No separate graph server or portal account is required.

Open **Projects** from the desktop. The board and graph use the same tasks. Directed dependencies reject cycles; related links are symmetric. Dependencies show context without preventing status changes. Task checklists and task-attached sticky notes retain their own identities. Drag a card by its handle or focus the handle and use arrow keys (Shift for larger steps) to move it; its position is a personal preference saved in this browser, separately for each account and project board. Moving a note does not edit the shared record or change its revision. Task-attached notes follow the same rule. Existing shared positions are ignored; an unset personal layout starts in a grid.

## Shared project interface

The native Projects app uses the portal board’s shared styles, responsive column controller and timeline controller in connected **and standalone** installations. It runs against the local project API; no embedded portal or connected account is required. The default board shows task columns, a schedule preview, and a combined **Notes & Resources** canvas. Board, Graph, Deliverables, Timeline, Activity and Trash remain available as views.

- Move tasks by dragging or using **Move to…**, and assign members directly on a card. Narrow app windows use swipe navigation and a status selector.
- Notes save inline after typing stops. A failed save retains the draft and offers retry or reload; changing boards or views warns before discarding unsaved notes. Realtime updates do not replace an open item editor. Revision conflicts require reloading the saved version.
- Notes and resources expand into movable, resizable paper cards; tasks open in the right-side editor. Resource cards organize Overview, Notes, Activity and Settings, including type, lifecycle status, provider, environment and public URL. These are ordinary native resource records; portal-only infrastructure credentials, monitoring and billing are not copied into the open-source UI or graph replication.
- Schedule bars support dragging and edge resizing on desktop, with an accessible date editor and a compact list on narrow windows. Writes carry the revision observed when editing began, including when a background update arrives during an edit.
- **Tidy cards** resets only your current board’s browser layout. It does not move other members’ cards or modify shared content.

The asset provenance manifest lives at `workspace/desktop/src/project-board/portal/provenance.json`. Keep these assets synchronized with the source board; transport adapters preserve each host’s authentication and authorization. `GET /api/projects/members` includes the authenticated `actor.id` for author-only note editing and the Assigned to me filter. Server authorization remains authoritative.

All tasks, notes and task comments are shared with current workspace members. There is no private task/publication switch. Administrators manage the status catalog, including names, colors, order, the default and retirement replacements. Retiring a status moves its tasks to an active replacement in the same reporting category. Done tasks remain editable; explicit review acceptance still requires a separate reviewer.

Each workspace has one Team Channel. New task comments also appear there in the same database transaction. Replying to a task message adds a comment to its task. Ordinary chat stays in the channel; mention `@Alshival` to invoke the agent. Private agent conversations remain separate.

## Project boards

Use **Project board** to select a board. Administrators can create, archive and restore boards under **Board settings**. Each board owns its tasks, deliverables, notes and ordered status catalog. The original **Workspace board** remains available for existing records that have no board ID. Native installations impose no commercial board limits.

A task uses a status from its own board. To move a task through the API, update both `board_id` and the destination `status_id` with the current revision. The task identity, attached notes and comments remain intact. Dependencies and related links may connect tasks across active boards. Archived boards retain their records and relationships; ordinary project reads and graph context hide their contents until restoration. Board management shows archive metadata.

`GET /api/projects/boards` discovers board identities. Create a board through `/items` with `kind: "board"` and its title. Task, note and deliverable data accept `board_id`; status data accepts the same optional UUID. The optional sync snapshot remains version 2 and advertises `capabilities.project_boards: true`. Integrations must negotiate this capability before mirroring multiple boards; older peers keep their original single-board projection.

## Optional integrations

Projects → Board settings → API & MCP connections creates expiring, revocable user-bound credentials. Tokens appear once and are stored only as hashes. Ordinary keys support `project:read` and `project:write`; current project administrators can also issue `project:sync`. Role removal invalidates sync authority on the next request.

- REST: `https://YOUR-INSTANCE/api/projects`
- MCP: `https://YOUR-INSTANCE/api/projects/mcp`
- Authentication: `Authorization: Bearer CREDENTIAL`
- `/items` pages up to 100 records using `next` as the following `after` cursor.
- `/sync/snapshot` version 2 includes stable identities, tombstones, status catalogs and a graph revision. Discard snapshots whose revision changes between pages.
- Item updates require the observed revision and an idempotency UUID. Sync edge creation/restoration also requires `expected_revision`; edge deletion requires `revision`.

Note positions are not part of shared content synchronization. Integrations should omit legacy `position` values when comparing or applying note content; local arrangements belong to each application.

An optional integration can mirror the graph, but Neural Labs continues operating independently when it is disconnected. Billing, hosted plan eligibility and support policy belong to the integrating service. File, resource, service-ticket and billing migration are separate from task-graph sync.

## Automatic connected graph replication

A configured managed connection may use the signed `POST /api/projects/sync/bridge` transport without a browser session or a user-created key. Standalone installations do not expose this bridge. Each call is bound to the configured workspace/instance and reauthorized by the connected service for the current generation. It only supports graph snapshots and revision-checked item, status and edge writes; it grants no approval actions, account login or tools.

The snapshot advertises `automatic_sync` and `source_edit_clocks`. Migration 27 adds `sync_edited_at` to items, statuses and edges. Native writes receive database timestamps, including bulk writes. Authorized replication preserves the source timestamp using the optional `sync_edited_at` write field; ordinary user writes cannot supply it. Source timestamps are separate from arrival timestamps so copying data never makes it the latest edit.

The Alshival adapter provisions verified member subjects on first synchronization, including members who have never signed in. Its dedicated graph principal has no login identity and is disabled outside the authenticated service transport. Hosting eligibility, retry policy and conflict decisions remain in the integrating portal. The portal selects the newest conflicting version, retains the overwritten version, and handles exceptions through administrator diagnostics without requiring a user sync screen.

## Project-management proposal template

Automations → Project management template opens **Alshival - Project Management**. It publishes paused with a 09:00 and 17:00 daily schedule in the selected timezone. Review the timezone, owner, connection and prompt before enabling. Runs use read-only execution and the `read_project_graph` tool; results are proposals with task IDs and revisions, for a member to apply manually. It does not automatically change tasks or notify external recipients.

## Upgrade from the legacy task and channel model

Migration 22 deletes all legacy Team Chat channels/messages on managed and self-hosted installations and creates one fresh everyone channel. Private agent conversations are unaffected. Legacy internal/unpublished task content and its task descendants are deleted. Published tasks retain their public text rather than exposing old staff text. Existing shared task comments remain on their tasks and are not backfilled into the fresh channel, including after comment edits or task restoration.

This is a destructive, one-time migration. Use the installation’s gated upgrade and recovery procedure with a verified pre-upgrade database copy. Do not downgrade over the migrated database or restore a copy over accepted new writes. Migration retries preserve messages created after the reset. Source publication alone does not upgrade an installation.

## Connected notes and resources

Native notes render Markdown, including lists, code, tables and links. Select the text to edit; typing `!` opens a searchable resource picker with arrow-key and Enter selection. Choosing a resource inserts a navigable mention and creates an authorized related link. Raw HTML is escaped and remote images are displayed as their alt text.

Expanded notes and resources keep the paper appearance, with quiet scrollbars, browser-local move/resize controls and a compact mobile card switcher. Task editing stays in the right-side pane. Small board cards omit relationship lists; expand an item and open **Connections** to search for tasks, notes or resources. Related links are symmetric; dependencies remain task-only and reject cycles. Neither linking nor moving a note changes access or authorship.

A note has one optional resource home on the same board. Select **Move to resource** on an expanded note, or attach/drop it in the resource's **Notes** section. **Return to board** preserves its identity, text and links. Archiving, retiring, hiding, deleting or moving its resource to another board returns attached notes to the board. Only the note author or a project manager can move or edit it. Conflicting edits retain the draft and require retry or explicit reload.

Resource records, resource homes, and cross-type relations are local to each installation. The existing connected graph bridge still synchronizes task-to-task edges and the supported task/note fields; it does not replicate resources or resource-home IDs. Portal associations and native associations remain independent. The optional portal integration does not add billing, infrastructure credentials, monitoring or alert delivery policy to the native board.
