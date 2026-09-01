# Architecture

## Step 1 goal

Kiki runs one isolated OpenClaw development cell per developer. Each cell serves OpenClaw's built-in web Control UI and gives its agent a persistent private home in which it can run commands, manage repositories, and keep state.

Authenticated landing-page routing and a public reverse proxy are later steps. Step 1 publishes each Gateway only on a unique host loopback port so it can be tested locally or through an operator-controlled tunnel.

## Trust boundaries

The unit of isolation is a **tenant cell**, not an OpenClaw user account. A cell has a dedicated Gateway, bridge network, home directory, secrets, web port, and resource limits. This follows OpenClaw's documented one-cell-per-tenant model; OpenClaw does not claim hostile multi-user isolation inside one Gateway.

The developer and their agent own everything in the tenant home. Only credentials that developer and agent may use should be placed there.

The host is a separate trust boundary. Tenant containers do not receive:

- host `sudo`;
- `/home/data-team`, `/root`, or another host home;
- another tenant's state directory;
- the Docker or Podman socket;
- privileged mode, host networking, or host PID/IPC namespaces.

The custom image permits `sudo` inside the container so development commands can install packages. That changes the disposable container filesystem, not Kiki. It does increase the impact of a container-runtime or kernel escape, which is a documented residual risk.

## Components

### Host control plane

Owned by `data-team`:

- image build and promotion;
- tenant lifecycle scripts and optional systemd units;
- loopback port allocation and future authenticated ingress;
- resource allocation and monitoring;
- tenant backups and restore tests;
- shared-skill review and release;
- shared MCP operation and credential issuance.

This repository does not replace Kiki's existing Nginx, Docker volumes, websites, or recovery configuration.

### OpenClaw development container

Each tenant uses an official, pinned OpenClaw image extended with Git, SSH, certificates, and container-local `sudo`. It runs an independent Gateway and serves the Control UI on container port `18789`.

The Gateway is published on a unique host loopback port and requires a unique token from the tenant secret environment file. Provider credentials, channel credentials, and the tenant MCP token are never placed in the Compose file or Git.

The OpenClaw agent can execute commands within its container and persistent home. It cannot manage sibling cells or the host container runtime.

### Persistent tenant home

The host path is conventionally:

```text
/srv/neural-labs/tenants/<tenant>/home
```

It is mounted at `/home/node` in the container. Important state includes:

- `.openclaw/` configuration, agent state, sessions, and workspace;
- `.ssh/` client configuration and keys authorized for that developer;
- source repositories and personal skills; and
- normal shell and development configuration.

Every cell has a separate home even though its in-container UID/GID is `1000:1000`. Host paths and mounts, not shared Linux accounts, separate the cells.

### Web application

OpenClaw's Gateway serves the built-in Control UI over the same port used for HTTP and WebSocket APIs. Step 1 binds that port to `127.0.0.1` on Kiki. Access is by local browser or an explicitly managed tunnel and always requires the tenant Gateway token.

The later landing-page design will authenticate a developer, resolve their assigned tenant, and proxy HTTP/WebSocket traffic to that cell. It must preserve Gateway authentication and enforce tenant mapping server-side. It is not implemented here.

### Shared team skills

The repository `skills/` directory is deployed to a host-controlled release path and mounted read-only at `/opt/alshival/openclaw-skills`. Each tenant config lists that directory in `skills.load.extraDirs`.

Extra directories have low precedence in OpenClaw. A developer can override a team skill from their workspace. That is acceptable for personal behavior but must never be treated as a policy bypass: authorization remains in MCP, credentials, container isolation, and the host.

### Shared MCP service

Tenants connect to one HTTPS Streamable HTTP MCP endpoint. Each tenant receives a separate credential and tool allowlist. The sample OpenClaw configuration excludes administrative tools by default.

The MCP service must enforce identity and authorization server-side. Prompt instructions and client-side tool filters are defense in depth, not the primary access control.

## Network paths

| Source | Destination | Step 1 policy |
|---|---|---|
| Local operator/tunnel | Tenant Gateway web port | Loopback only; Gateway token required |
| Tenant container | Internet model/channel providers | Allow with monitoring |
| Tenant Gateway | Shared MCP HTTPS endpoint | Allow; per-tenant auth required |
| Tenant cell | Other tenant cell | Deny |
| Tenant cell | Host administration ports | Deny except explicitly approved services |

Compose creates one bridge network per tenant project. This prevents accidental container-name discovery across projects. Host firewall rules remain necessary because container runtimes may alter packet-filter paths.

## Resource envelope

The example limits each active cell to 2 vCPU, 3 GiB RAM, and 512 processes. These are ceilings, not steady-state reservations. Browser automation and dependency builds can reach the limit. Before onboarding the whole team, measure Kiki with at least two simultaneous pilot cells and keep at least 25% memory and CPU headroom for hosted services.

Model inference is assumed to be hosted. Local model inference is outside this skeleton's capacity model.

## Lifecycle

1. Review and pin the Gateway base and overlay images.
2. Render a tenant directory with `provision-tenant.sh`.
3. Place secrets out of band and run OpenClaw onboarding.
4. Start the cell and test the loopback Control UI.
5. Enable the tenant systemd instance if desired.
6. Back up and periodically restore-test the tenant home.
7. Disable access, revoke credentials, archive, and eventually remove the cell during offboarding.

## Deliberate non-goals for Step 1

- a login landing page or tenant-aware reverse proxy;
- public, LAN, or direct VPN exposure;
- a separate interactive operating-system environment;
- Kubernetes or a self-service tenant portal;
- sharing one Gateway between developers;
- granting tenant agents a host container socket;
- moving Kiki's legacy applications into this platform;
- implementing the production MCP authorization service;
- embedding real credentials or Kiki-specific network addresses.
