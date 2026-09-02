# ADR 0001: Containerize application services behind loopback ingress

- Status: Accepted
- Date: 2026-09-01

## Context

Neural Labs needs a landing page, an authentication/control plane, an MCP
resource server, and durable relational state. Self-deployers need one
repeatable topology, while the production host already has a working Nginx TLS
configuration.

## Decision

Run the landing page, control plane, MCP server, and PostgreSQL as separate
Compose services. Publish only the three HTTP listeners, and publish them on
the configured loopback address. PostgreSQL is not published. Host Nginx
remains the only public ingress and routes same-domain paths to those listeners.

The landing, control-plane, and MCP containers use read-only root filesystems
and drop all Linux capabilities. Operators maintain one ignored root `.env`;
Compose passes each service only its required environment values. Docker daemon
access is therefore explicitly part of the secret-bearing operator boundary;
tenant workloads never receive that access.
PostgreSQL state is the only named data volume. The control plane holds the
encrypted Entra confidential-client credential; MCP receives only tenant,
client, scope, audience, and endpoint values over an authenticated internal
route.

## Consequences

- Public traffic cannot reach an application listener without Nginx.
- Docker restart policies bring the containers back with the Docker systemd
  service after a reboot.
- Environment setup names the only email allowed to claim the initial
  administrator, avoiding a public first-visitor race.
- A usable backup requires both PostgreSQL data and the root `.env`, especially
  its control-plane encryption key.
- Docker daemon operators can inspect service environment values and must be
  trusted equivalently to host root. Retaining read-only application
  filesystems was preferred over Compose's environment-secret implementation,
  which requires writable service filesystems on the supported host runtime.
- Nginx installation, service replacement, and other host mutations remain
  explicit operator actions.
