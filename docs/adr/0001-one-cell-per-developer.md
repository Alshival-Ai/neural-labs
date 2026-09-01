# ADR 0001: One cell per developer

- Status: Accepted
- Date: 2026-08-31

## Context

Kiki must support concurrent developers whose automations have access to their own workspaces and credentials. OpenClaw's Gateway is a trusted-operator boundary, not a hostile multi-user security boundary.

## Decision

Run one isolated cell per developer. A cell owns one OpenClaw Gateway and Control UI, bridge network, persistent home, Gateway token, MCP credential, web port, and resource allocation.

## Consequences

Tenant lifecycle and upgrades require orchestration across multiple containers. In exchange, state, credentials, ports, and failures are separable. No developer shares an OpenClaw process with another developer.
