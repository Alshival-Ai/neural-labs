# ADR 0004: Loopback-only web ingress for Step 1

- Status: Accepted
- Date: 2026-08-31

## Context

Each OpenClaw Gateway already serves the developer-facing Control UI. The eventual platform will authenticate developers at a shared landing page and route each verified identity to its assigned cell, but that identity and proxy layer is not part of the initial skeleton.

## Decision

Publish every tenant Gateway on a unique `127.0.0.1` host port and retain OpenClaw token authentication. Initial access is local or through an operator-controlled tunnel.

## Consequences

Step 1 can prove container lifecycle, persistence, command execution, skills, and MCP access without prematurely exposing tenant applications. Direct team access waits for a reviewed reverse proxy that supports both HTTP and WebSocket traffic and enforces the identity-to-tenant mapping server-side.
