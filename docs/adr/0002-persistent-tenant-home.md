# ADR 0002: One persistent home per cell

- Status: Accepted
- Date: 2026-08-31

## Context

An OpenClaw development environment needs durable repositories, SSH client configuration, agent state, and workspaces while containers remain replaceable.

## Decision

Give each cell a dedicated host-managed directory and mount it as `/home/node`. The developer and agent treat this as their private environment. No other cell receives the mount.

## Consequences

Image upgrades do not erase the developer's work or OpenClaw state. Credentials placed in the home are readable by the agent by design. Backups must include the whole tenant directory and be handled as sensitive data.
