# Provision a tenant

Run these steps as `data-team`. Do not paste resulting credentials into terminals with command logging, chat, Git, or tickets.

## 1. Allocate identity and port

Choose a lowercase tenant ID and unique Gateway web port. Confirm the port is free:

```bash
sudo ss -lntup
```

## 2. Render the tenant directory

For example:

```bash
./scripts/provision-tenant.sh example-dev 18791
```

The script creates the tenant home, OpenClaw config, random Gateway token, and environment files. It does not start a container, publish an external route, or change the firewall. It refuses to overwrite an existing directory.

## 3. Issue scoped credentials

Edit `/srv/neural-labs/tenants/<tenant>/secrets/gateway.env` without displaying it in logs:

- replace the example MCP URL;
- replace the MCP placeholder with a credential unique to this tenant;
- add only provider and channel credentials approved for this developer.

Keep the directory mode `0700` and files mode `0600`. The MCP policy should begin with the minimum read tools and add write tools explicitly.

## 4. Review runtime inputs

Review `tenant.env` for:

- a tenant-exclusive home path;
- an immutable promoted Gateway image reference;
- a unique loopback web port;
- resource limits appropriate for Kiki.

Never point `TENANT_HOME_DIR` at `/home/data-team`, `/root`, or another tenant.

## 5. Validate and onboard OpenClaw

Render the Compose model before starting:

```bash
./scripts/tenant-compose.sh <tenant> config
```

Start the cell, then use the same pinned Gateway image and tenant mount to run OpenClaw's supported onboarding flow. Prefer environment-backed secret references so plaintext provider and Gateway tokens are not copied into `openclaw.json`.

OpenClaw changes quickly; confirm the onboarding flags against the official Docker documentation during each platform release.

## 6. Smoke test

Verify:

- the Gateway `/healthz` endpoint is healthy on its assigned loopback port;
- the Control UI loads through a local tunnel and requires the tenant's Gateway token;
- the agent can run commands, use container-local `sudo`, and modify only its own home;
- Git and SSH read the tenant's `.ssh/config`;
- the shared skills path is visible and read-only;
- MCP calls carry the tenant identity and denied tools fail closed;
- the tenant cannot resolve or reach another tenant container directly;
- no Gateway port is reachable on Kiki's non-loopback interfaces;
- Kiki's existing sites and services remain healthy.

## 7. Enable supervised startup

Only after the smoke test:

```bash
sudo systemctl enable --now neural-labs-tenant@<tenant>.service
```

Record the tenant owner, loopback port, image digest, MCP policy, provision date, and backup class in the team's protected inventory.
