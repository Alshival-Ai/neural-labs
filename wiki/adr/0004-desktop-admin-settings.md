# ADR 0004: Move administrator settings into the workspace desktop

- Status: Accepted
- Date: 2026-09-01

## Context

Neural Labs now has a shared desktop that is the primary surface for every
active user. Keeping a separate `/admin` single-page console duplicates product
navigation and separates runtime controls from the OpenClaw environment they
manage. The Settings design already provides a desktop-native home for these
controls.

The move must not weaken authorization. A hidden launcher is not a security
boundary, and the workspace container must not receive database credentials,
control-plane secrets, or direct administrative authority.

## Decision

Move settings into a role-aware Settings application built with the workspace
desktop. Show its dock cog to every active user. Members receive only the
Personalization area for device-local appearance and their own account;
administrators receive Personalization plus the control-plane navigation.
Remove settings links from the account menu and retire the console's `/admin`
routes; legacy `/admin` paths redirect to `/workspace`.

Keep all administrator data and mutations on the existing control-plane
`/api/admin/*` endpoints. Those endpoints continue to verify the live session,
active account status, administrator role, same-origin request, and CSRF token.
The workspace frontend receives only the display-safe API responses already
used by the old console. It receives no database connection, encryption key,
Entra secret, certificate private key, OpenAI token, or workspace control
token.

Retain the `console/` bundle for login, signup, and pending approval. Move
active-user account management into Settings → Personalization, and redirect
the legacy `/account` route there. Keep first-run setup server-rendered.

## Consequences

- Administrators manage users, authentication, MCP, workspace provider pairing,
  and audit history without leaving the desktop.
- Regular users see only Personalization. Server-side authorization still
  rejects every direct administrator API request.
- No container, port, database access path, or Nginx upstream is added.
- The workspace image now contains the administrator UI, but the control plane
  remains the only authority for administrator operations.
- Existing bookmarks under `/admin` return to the shared desktop instead of
  serving a second management application.
