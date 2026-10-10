# ADR 0050: Share project tools across agent transports

- Status: Accepted
- Date: 2026-10-10

## Context

External project MCP clients and native workspace agents need the same task and
relationship operations. Connected portals have separate storage and permission
policies, so a shared catalog must not imply shared credentials or unrestricted
access to another workspace.

## Decision

Version the tool names, inputs, results, and error envelopes in
`contracts/project-tools.v1.json`. Both MCP adapters use that contract. Native
calls pass through the execution broker to an authenticated private control-plane
endpoint, with the actor selected from the broker's execution grant. Providers
cannot supply another actor or obtain the service credential. Revalidate grants
before invocation and before returning results; read-only turns reject mutations.

External calls retain environment scopes and fresh member authorization. The
same domain adapter enforces item visibility, revisions, dependency-cycle checks,
and transactional idempotency receipts. Connected portals may implement the
contract using their own authorized records and optional board restrictions.

Synchronizers negotiate `shared_graph_v1` before exchanging related links across
tasks, notes, and resources. Preserve IDs, clocks, and explicit tombstones; never
infer deletion from an omitted record. Resource projections contain public
metadata only. The new receipt table is additive.

## Consequences

Each transport exposes the same capabilities while retaining its authentication
boundary. Legacy browser routes and graph-read aliases remain available. Contract
changes require matching packaged copies and conformance tests in every adapter.
See [Shared project tools](../project-tools.md) for usage and update requirements.
