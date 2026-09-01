# ADR 0003: Share MCP infrastructure, not credentials

- Status: Accepted
- Date: 2026-08-31

## Context

The team has common tools and data that should not be separately deployed for every OpenClaw cell.

## Decision

Operate one HTTPS Streamable HTTP MCP service, but issue a unique identity and scoped credential to every tenant. Enforce authorization at the service. Apply client-side OpenClaw tool filters as defense in depth.

## Consequences

The shared service reduces operational duplication and centralizes auditing. It also becomes shared infrastructure whose availability affects every tenant. Credential rotation, rate limiting, audit attribution, and default-deny authorization are required before production use.
