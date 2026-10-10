# Shared project tools

The workspace agent and `/api/projects/mcp` use the versioned contract in
[`contracts/project-tools.v1.json`](../contracts/project-tools.v1.json). Connected
portals can implement the same contract over their own storage and permissions.

The catalog includes `project_list`, `project_get`, `project_create`,
`project_update`, `project_action`, `project_boards`, `project_members`,
`project_statuses`, `project_status_write`, `project_comments`, `project_edges`,
`project_link`, and `project_unlink`. Existing browser REST endpoints and the
workspace agent's `read_project_graph` remain available.

Read records before editing. Treat IDs and revisions as opaque values; supply
the returned revision and a fresh UUID `idempotency_key` for each mutation. Retry
an interrupted request with the same arguments and request ID. A conflicting
revision requires another read and a deliberate merge. `project_link` uses
`expected_revision: 0` for a new relationship. Removing a relationship retains
its identity, revision, and deletion marker. Dependencies connect two tasks and
cannot form cycles; related links can connect tasks, notes, and resources.

Read `project_statuses` before changing a board's status catalog. Its revision
is a string independent of each status's integer revision. Specify `board_id`
to operate on another authorized board. A connected portal may restrict its
agents to one board without changing standalone installations. Note replies
are immutable history; task comments can be edited under their existing policy.

The external MCP transport requires an environment credential with
`project:read` and, for mutations, `project:write`. Credentials, membership, and
managed authorization generations are checked at invocation. Discovery grants
no authority. Built-in agents use a private runtime transport: the execution
actor is bound by the runtime, read-only execution denies mutations, and revoked
turns cannot invoke tools or receive a completed response. Provider processes
never receive the control-plane service token.

Graph synchronization advertises `shared_graph_v1` for related note/resource
edges, deletion markers, and public resource metadata. Portal adapters must
negotiate this capability and preserve the older task-only projection for older
peers. Operational resource configuration, SSH credentials, and secrets do not
belong in graph synchronization. Missing records are not inferred deletions.

Contract changes require updating both packaged JSON copies and the portal's
pinned copy, conformance tests, migration/preservation tests, and a coordinated
release. Publishing this repository does not upgrade installed workspaces.
