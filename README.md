# Neural Labs

Neural Labs is the infrastructure skeleton for Kiki's shared OpenClaw development platform. Step 1 gives each developer an isolated OpenClaw cell with:

- one OpenClaw Gateway and its built-in web Control UI;
- one persistent private home for repositories, SSH configuration, OpenClaw state, and workspaces;
- read-only team skills;
- access to the shared MCP service through a tenant-specific credential; and
- container-local command execution and `sudo`, without host administration.

The `data-team` account remains the only unrestricted host administrator. A tenant cannot access another tenant, Kiki's admin home, or the host container socket.

> This branch is a platform skeleton, not a production deployment. It does not modify Kiki, create accounts, publish a web endpoint, or contain credentials.

## Step 1 architecture

```text
Developer (temporary local tunnel/access method)
                         |
                         | unique loopback port + Gateway token
                         v
+---------------- OpenClaw tenant cell ----------------+
|  Gateway + Control UI + command tools                |
|                         |                            |
|               persistent private home               |
|        repositories, .ssh, state, personal skills   |
|                         |                            |
|              read-only team skills                  |
+-------------------------|----------------------------+
                          |
                    HTTPS + tenant auth
                          v
                    Shared team MCP

data-team owns lifecycle, images, policy, backups, and host services.
```

OpenClaw explicitly recommends one cell per tenant because a single Gateway is a trusted-operator boundary. The Gateway already serves the Control UI web application, so Step 1 needs no companion application container.

Future work will put an authenticated landing page and reverse proxy in front of these cells. After login, that control plane can route a developer to their assigned Gateway. That routing and identity layer is deliberately outside Step 1.

## Repository map

- `platform/compose/` defines one repeatable OpenClaw tenant cell.
- `images/openclaw-gateway/` adds development command-line tools to the official image.
- `scripts/` provisions, validates, and operates tenant directories.
- `skills/` holds team-wide, read-only OpenClaw skills.
- `tenants/` contains a non-secret tenant manifest example.
- `docs/` contains architecture decisions and operator runbooks.
- `platform/systemd/` contains an optional host service template.

## Safe local preview

The validation path does not start containers or require credentials:

```bash
make validate
```

To render a non-secret tenant directory under `/tmp`:

```bash
STATE_ROOT=/tmp/neural-labs-tenants \
  ./scripts/provision-tenant.sh example-dev 18791
```

Provisioning creates a random Gateway token without printing it and deliberately leaves MCP credential issuance as an operator action. Follow [the tenant runbook](docs/runbooks/provision-tenant.md) before starting a cell.

## Design status

The decisions captured here are intentionally narrow:

- one Gateway container per developer;
- one persistent container home per developer;
- Gateway web ports bound to loopback by default;
- outbound access allowed, with per-service credentials and MCP tool filters;
- no host Docker/Podman socket, host admin home, or other tenant mount;
- version- or digest-pinned OpenClaw images before deployment.

See [Architecture](docs/architecture.md), [Threat model](docs/threat-model.md), and [Bootstrap Kiki](docs/runbooks/bootstrap-kiki.md).

## Upstream references

- [OpenClaw multi-tenant hosting](https://docs.openclaw.ai/gateway/multi-tenant-hosting)
- [OpenClaw Docker deployment](https://docs.openclaw.ai/install/docker)
- [OpenClaw security guidance](https://docs.openclaw.ai/gateway/security)
- [OpenClaw MCP configuration](https://docs.openclaw.ai/cli/mcp)
- [OpenClaw skills configuration](https://docs.openclaw.ai/tools/skills-config)
