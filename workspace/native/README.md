# Native runtime migration components

These modules are preparatory components. They are not selected by `start.mjs`,
the container image, the desktop, or the managed host admission manifest yet.
Do not activate a pilot using only these modules.

`codex.mjs` implements the pinned 0.155.1 app-server stdio protocol;
`claude.mjs` implements the pinned 2.1.226 structured streaming host protocol.
Both keep native sessions, emit output/tool events, mediate permission requests,
interrupt/cancel, recheck execution leases and release their processes after
each turn. A scheduled permission request produces a blocked outcome. Transport
failure produces an unknown outcome. Protocol initialization has a separate
network-disabled container probe; it is not authenticated inference acceptance.

`turns.mjs` binds these adapters to durable turn records, event cursors and scoped
approvals. It requires a control-plane execution authorizer and a host/container
launcher that isolates the selected credential filesystem view for **both**
version probes and provider launches. Environment allowlisting alone cannot
protect other owners' homes from native read/shell tools. Admission starts closed.
The launcher, desktop/API routes, native login and application MCP integration
are not wired into the deployed runtime in this change.

`state.mjs` owns SQLite occurrence claims, workflow locks, checkpoints, private
conversation bindings and reconnect events. The default execution and delivery
gates are closed. Unknown outcomes retain locks and are never automatically
replayed. Runtime startup reconciliation requires an exclusive host/runtime
lease. Independent workflows do not share a concurrency semaphore.

`migration.mjs` creates an immutable, private preservation bundle from explicit
filesystem roots and complete record collections. Its importer verifies an
operator-supplied SHA-256 and workspace binding, journals progress, resumes
identical partial copies, and refuses conflicting files or records. It retains
the exact source definitions and histories. All imported jobs remain held for
native account and policy review without changing their enabled flags.
Filesystem archives retain original paths, modes, owners and collaboration
metadata in package files; activating those packages still requires a reviewed path map. Source
symlinks/devices/sockets require an explicit operator mapping instead of being
followed or discarded. Sources must already be drained and quiescent.

Control-plane collections must come from one read-only repeatable-read PostgreSQL
transaction. The importer retains them as evidence; it does not restore or
rewrite PostgreSQL, send notifications, reset chats or reconnect accounts.
Record collections must include jobs, every available run receipt, scratch,
proposals, checkpoints, ownership, skill settings, notification preferences,
subscriptions, config, summaries, events and deliveries, including empty lists.
Every record has an explicit `{key, value}`. Keys identify source records; file
hashes and record hashes identify content. Unsupported jobs remain visible.
`legacy-sqlite.mjs` reads current OpenClaw scheduling/workshop tables in one
read-only SQLite transaction. It includes proposal events and rollback records,
retains raw schema/row evidence, and rejects ambiguous job IDs across stores.
It never reads secret-store, device-auth or provider credential tables.

The operator CLI is `node bin/native-migration.mjs`:

```sh
node bin/native-migration.mjs inventory --legacy-db /private/source/openclaw.sqlite
node bin/native-migration.mjs export --config /private/export.json --destination /private/new-bundle
node bin/native-migration.mjs import --source /private/new-bundle --destination /private/retained \
  --database /private/native.sqlite --workspace WORKSPACE_ID --sha256 MANIFEST_SHA256
```

The export config specifies `workspace`, `chatResetPolicy`, `trees`, an absolute
`recordsSnapshot` JSON path, and an optional `legacyDatabase` path. `trees` must
explicitly include `teamSkills`, `personalSkills`, `drafts`, `proposalPackages`,
`installedSkills`, and `artifacts`. Supply existing empty directories when a
collection is empty. The snapshot must contain every `RECORD_CATEGORIES`
collection; when `legacyDatabase` is supplied, omit exactly the five collections
it supplies: jobs, receipts, scratch, proposals and sourceTables. Export refuses
overlapping source collections. Merge the output of the operator-only
`snapshotNativePreservation` control-plane primitive with explicit checkpoint
and skill-setting snapshots; never manufacture empty collections for data that
has not been inventoried. Preserve all manual-run helper registries as artifacts.

`schedules.mjs` renders separate timezone crontabs with a fixed runner and job ID,
and calculates anchored interval, one-time, process-exit and stream occurrences.
Calendar execution requires a separately pinned and verified Supercronic build;
the renderer alone is not calendar/DST acceptance. Its runner path is reserved
for the authenticated native runtime integration and is not installed yet.

The remaining release gates include provider execution acceptance, runtime API
and desktop replacement, native login/approval UI, application MCP adapters,
notification transports, managed admission/cutover, immutable multi-architecture
images, full preservation and browser acceptance, and measured ARM64 capacity.
No release digest, production migration, NAS backup or Pi acceptance is implied.
