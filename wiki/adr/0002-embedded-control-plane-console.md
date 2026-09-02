# ADR 0002: Embed the control-plane console

- Status: Superseded by [ADR 0004](0004-desktop-admin-settings.md)
- Date: 2026-09-01

## Context

The growing administrator interface needs persistent navigation and dedicated
pages for users, authentication, MCP, and audit activity. Self-deployed Neural
Labs instances should not need another public listener, proxy upstream, or
runtime service merely to serve the application UI. Authorization must remain
server-controlled even when navigation is client-rendered.

## Decision

Build a React, TypeScript, and Vite single-page application from `console/`
during the control-plane container build. Copy the production bundle into the
control-plane image and serve it below `/control-assets/console/`. Return its
entry point for login, signup, account, and administrator routes only after the
Express control plane applies the relevant setup, session, account-status, and
role checks. Keep first-run `/setup` server-rendered.

Expose purpose-specific JSON endpoints for console data and mutations. Require
the existing same-origin and CSRF protections for mutations, and map database
records to explicit public response objects so authentication secrets and
identity subjects never cross the browser boundary.

## Consequences

- The console gains responsive shared navigation and independently maintainable
  pages without adding a container, port, or Nginx upstream.
- Direct links to administrator pages work because Express serves the SPA entry
  point after authorization.
- Client-side route guards improve navigation but are not a security boundary;
  every protected JSON request is authorized again by the server.
- The control-plane image build now depends on both the backend and console
  lockfiles, and repository validation tests both packages.
- First-run recovery remains available without the SPA JavaScript bundle.
