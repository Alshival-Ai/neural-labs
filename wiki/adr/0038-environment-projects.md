# 0038 — Environment-local project content

Project content belongs to the deployment's PostgreSQL and persistent file volumes.
The browser, desktop and external API/MCP clients use the same project service.
The revision WebSocket contains invalidations, not a second content database.
Each mutation is serialized, revision checked and deduplicated per actor/request ID.

The project service is generic. It does not contain Alshival billing tiers or
provisioning policy. Optional managed identity uses the existing identity adapter;
standalone deployments retain local identity. External credentials are hashed,
user-bound, scoped, revocable and expire in at most 90 days. They do not authorize
access to any other deployment. HTTP requests and WebSockets recheck membership.

## Delivery status

The initial service implements tasks, deliverables, notes, resources, tickets,
comments, review, dates, archives, local history, direct REST and MCP, and the
Projects desktop view. It is not yet a migration-compatible replacement for the
portal board. Custom board statuses, publication rules, full resource operations,
file migration and verified bidirectional transfer must be complete before a
managed workspace is cut over. The portal retains an explicit migration gate.

Protected hosting is an operational policy, not a certification. Customer ingress,
provider/egress restrictions, backup/restore evidence, legacy-copy disposition and
applicable agreements must be verified separately. Do not activate protected-data
use based on this app's presence or container health.
