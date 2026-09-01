# Bootstrap Kiki

This runbook describes a future installation. The repository skeleton does not perform these host changes.

## Preconditions

- Kiki's operating-system recovery and application validation are complete.
- The external migration backup remains unchanged and a new verified backup exists.
- `data-team` is the operator and only unrestricted host administrator.
- The chosen container runtime and Compose provider work without changing the legacy application's Docker storage unexpectedly.

## 1. Review the host

Record, without exposing secrets:

```bash
hostnamectl
free -h
df -h / /srv
nproc
docker version
docker compose version
sudo ss -lntup
sudo ufw status verbose
```

Do not reuse ports already assigned to Kiki's restored services.

## 2. Install the repository as a release

Keep the Git checkout owned by `data-team`. A recommended layout is:

```text
/opt/neural-labs/releases/<commit>/
/opt/neural-labs/current -> releases/<commit>
/srv/neural-labs/tenants/<tenant>/
/etc/neural-labs/platform.env
```

The `current` symlink supports an atomic code/config promotion. Do not point it at an unreviewed working tree.

## 3. Select the runtime

Kiki's recovered applications use the Docker snap path. The example systemd environment therefore uses `/snap/bin/docker`. Do not replace Docker or migrate `/var/snap/docker` as part of this platform bootstrap.

Rootless Podman remains a possible later migration. Test Compose compatibility, networking, systemd startup, volume ownership, and backup behavior before changing the runtime.

## 4. Build and pin the Gateway image

Use an official OpenClaw release digest as the base for the development overlay:

```bash
make gateway-build \
  OPENCLAW_BASE_IMAGE=ghcr.io/openclaw/openclaw@sha256:REPLACE_WITH_VERIFIED_DIGEST
```

Scan the result, record its digest, and use the immutable reference in tenant environments before production use. Never use `:latest` for a promoted tenant.

## 5. Install service templates

After reviewing paths:

```bash
sudo install -d -m 0755 /etc/neural-labs
sudo install -m 0644 platform/systemd/platform.env.example /etc/neural-labs/platform.env
sudo install -m 0644 platform/systemd/neural-labs.target /etc/systemd/system/
sudo install -m 0644 platform/systemd/neural-labs-tenant@.service /etc/systemd/system/
sudo systemctl daemon-reload
```

Do not enable the target until at least one tenant passes its manual smoke test.

## 6. Keep Step 1 ingress local

Every tenant Gateway binds to a unique `127.0.0.1` host port. Confirm it is not reachable from Kiki's LAN, VPN, or public interface. An operator may use an SSH tunnel for the first test:

```bash
ssh -L 18791:127.0.0.1:18791 data-team@kiki
```

Do not add an Nginx route or broad bind address until the authenticated landing-page design maps verified developer identities to the correct tenant and supports Gateway WebSockets safely.

## 7. Pilot before expansion

Run two concurrent pilot cells. Exercise Git/SSH, command execution, an OpenClaw automation, the Control UI, and MCP calls while monitoring host memory, CPU, swap, disk latency, and existing production endpoints. Adjust resource ceilings and maximum concurrent cells from measured data.
