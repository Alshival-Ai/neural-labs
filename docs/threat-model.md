# Threat model

## Protected assets

- Kiki's host, production services, backups, and admin credentials;
- each developer's repositories, SSH keys, tokens, sessions, and automation data;
- shared MCP data and privileged tools;
- tenant availability and host resource capacity.

## Principals

- `data-team`: trusted host administrator and platform operator;
- developer: trusted within their own tenant, untrusted with respect to other tenants and the host;
- tenant OpenClaw agent: has the same effective tenant-home access as its developer;
- shared MCP service: trusted to authenticate and authorize every tool call;
- external model/channel provider: outside the host trust boundary.

## Primary risks and controls

| Risk | Primary controls | Residual risk |
|---|---|---|
| Cross-tenant file access | Dedicated host paths, separate mounts, UID consistency, no shared writable volume | Container runtime or kernel compromise |
| Host takeover through container runtime | No socket mount, no runtime group membership in tenant, no privileged/host namespaces | Kernel/container escape |
| Agent abuses developer SSH access | Per-developer keys, remote-host authorization, audit logs, protected production workflows | Agent acts with developer's legitimate authority |
| MCP privilege escalation | Unique tenant identity, server-side scopes, default-deny tools, per-tool audit | MCP implementation defect or overly broad scope |
| Credential disclosure | Secrets outside Git, mode `0600`, separate tenant files, rotation runbook | Developer/agent can read its own credentials by design |
| Lateral network movement | One bridge per cell, VPN/firewall restrictions, service allowlists | Outbound egress is initially broad |
| Resource exhaustion | CPU, memory, and process limits; capacity monitoring | Shared disk I/O and host kernel remain common resources |
| Gateway web exposure | Loopback default, unique Gateway token, future authenticated proxy review | Stolen tenant token or proxy defect |
| Malicious shared skill update | Code review, protected branch, read-only release mount | Skill instructions are powerful but not an authorization boundary |
| Compromised base image | Official registry, immutable digest, staged updates, vulnerability scan | Upstream/supply-chain compromise |

## Security invariants

Validation fails if the Compose definition contains a container socket mount, broad host-home mount, privileged mode, or host namespace setting. Review must preserve these invariants.

The developer's OpenClaw environment and agent intentionally share a home. Do not place a credential in that home unless the agent may use it.

## Future hardening

- enforce egress allowlists per tenant;
- add short-lived SSH certificates instead of durable private keys;
- use an identity-aware proxy or VPN identity for Gateway access;
- sign and attest promoted container images;
- export OpenClaw and MCP audit events to centralized storage;
- enforce disk quotas and backup retention per tenant;
- evaluate stronger isolation (microVMs) for mutually hostile tenants.
- add an authenticated, tenant-aware reverse proxy for developer web access.
