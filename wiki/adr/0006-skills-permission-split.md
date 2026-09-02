# ADR 0006: Split Skills reads from administrator mutations

- Status: Accepted
- Date: 2026-09-01

## Context

The Neural Labs Skills desktop app needs to expose OpenClaw's effective skill
catalog, Skill Workshop, and ClawHub. Catalog, proposal, and registry reads
require `operator.read`. Enabling skills, installing third-party instructions,
scanning history, and changing proposal lifecycle state require
`operator.admin`.

All approved developers should be able to understand and invoke the main
agent's skills. Granting every browser `operator.admin` would also authorize
unrelated OpenClaw administration and would collapse the account-role trust
boundary established for the desktop.

## Decision

Use the ordinary authenticated Neura Gateway connection for Skills read
methods. Its scope ceiling remains unchanged.

Use the administrator ingress accepted in ADR 0005 for Skills mutations. The
route's `/workspace/automations/socket` name is historical; its actual security
contract is an active control-plane administrator check followed by a fixed
trusted-proxy identity capped at `operator.read,operator.admin`. Do not derive
or persist admin scope from client-side session state.

Keep the Skills launcher visible to regular users, but render mutation controls
view-only unless the administrator connection is live. Treat that rendering as
a usability rule only. Nginx and OpenClaw method scopes remain authoritative.

Bind apply and reject decisions to a newly inspected proposal revision hash.
Keep ClawHub installation scoped to the shared main-agent workspace because
the current Gateway install schema does not expose the CLI's global target.

## Consequences

- Developers can inspect and invoke the shared agent's real skill catalog.
- Only active Neural Labs administrators can enable, install, propose,
  evaluate, apply, reject, quarantine, or history-scan through the desktop.
- Third-party skill installation crosses an instruction supply-chain boundary,
  but OpenClaw's trust-envelope and install-policy checks remain authoritative.
- Skills and Automations currently share one admin WebSocket and fixed service
  identity. A future path rename may improve naming, but must preserve the same
  server-side authorization and scope ceiling.
- The existing public ingress set and host Nginx configuration do not change.
