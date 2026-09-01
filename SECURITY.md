# Security policy

## Reporting

Report a suspected vulnerability privately to the Alshival AI platform owner. Do not open a public issue containing credentials, hostnames that are not already public, VPN details, tenant data, or exploit instructions against Kiki.

## Secret handling

This repository must contain templates only. Runtime secrets live outside Git in per-tenant directories owned by `data-team`, with directories mode `0700` and files mode `0600`. Rotate a secret immediately if it is committed, pasted into logs, or exposed to another tenant.

## Security boundary

The supported isolation unit is one developer cell: a dedicated Gateway process/container, network, state directory, persistent home, Gateway token, and MCP credential. OpenClaw skills and prompt policy are not security boundaries. Container isolation, host filesystem permissions, firewall policy, and credential scopes enforce the boundary.

Host container socket access is prohibited because it is equivalent to host-administrator access. Tenant containers must not be privileged or receive broad host bind mounts.
