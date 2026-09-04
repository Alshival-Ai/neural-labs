# Desktop settings

Neural Labs settings live inside the shared desktop at `/workspace`. Every
active user receives the **Settings** cog in the dock. The account menu is kept
small and contains only the sign-out action.

Members open Settings with **Personalization** and **Plugins**. Personalization
controls their device-local desktop font size, shows their account identity,
lets them link available sign-in methods, and connects or pauses the personal
ChatGPT account used by interactive Neura. Plugins separates private,
user-owned connections from global workspace capabilities. Administrators
receive those same areas plus the control-plane areas below.

When that personal ChatGPT account is disconnected or paused, the desktop shows a
clickable onboarding toast after account bootstrap. Selecting it opens or
focuses Settings and switches directly to Personalization.

The old `/admin` console is retired. Requests to `/admin` or any nested legacy
path redirect active users to `/workspace`.

## Settings areas

| Area | Purpose |
|---|---|
| Personalization | Per-user desktop font size, account identity, linked sign-in methods, personal Neura ChatGPT connection, and sign out |
| Plugins | Private plugins attached only to the member's agents and global plugins available to every workspace member |
| Overview | Account counts, authentication state, plugin state, runtime health, and recent audit events |
| Users | User approval, rejection, activation, disabling, and Admin/User role assignment |
| Authentication | Local and Microsoft login enablement plus Entra secret or certificate rotation |
| Workspace | OpenClaw health and ChatGPT/Codex device-code pairing |
| Audit log | The latest security-sensitive account and configuration activity |
| About | Live runtime versions, service state, documentation, and project links |

## Security model

Hiding administrator navigation is not authorization. Every `/api/admin/*`
request independently verifies the live session, active status, and
administrator role.
Mutations also require an exact same-origin request and the session CSRF value
in `X-CSRF-Token`.

The API returns display-safe identifiers and configuration summaries only. It
never returns password hashes, provider subjects, client secrets, certificate
private keys, OpenAI access tokens, or bearer tokens. The final active
administrator cannot be demoted or deactivated, at least one web login provider
must remain enabled, and local login cannot be disabled until an active
administrator has linked Microsoft.

OpenAI device pairing remains workspace-owned. The control plane may start,
cancel, and report the fixed OpenClaw flow through a private token-authenticated
endpoint. The browser sees only the short-lived verification URL and user code;
OpenClaw keeps the resulting credential in its persistent workspace volume.
While pairing is active, Settings polls the control plane until the device code
arrives and continues polling until authentication succeeds, fails, expires, or
is cancelled; operators do not need to refresh the page between those states.
After OpenClaw's login process exits successfully, the controller refreshes the
local provider inventory before it classifies the result. This prevents a
best-effort Gateway refresh failure or stale cached status from hiding a newly
persisted OAuth profile. The CLI is not granted trusted-proxy access over
container loopback.

Personalization uses a parallel device-code controller scoped to the signed-in
user's dedicated OpenClaw agent. The control plane forwards only that immutable
user ID to an internal token-authenticated endpoint. It stores no OAuth token;
Settings polls only safe state, URL, code, expiry, model-readiness, and pause
metadata. Pause removes the user's Gateway access while retaining the OpenClaw
credential, and Resume restores it. Interactive Neura fails closed when the
personal account is unavailable. The Workspace pairing remains the independent
service identity for automations and background work.

The former MCP area is represented in Plugins as the locked, global **Neural
Labs Tools** system plugin. Every active member may inspect its display-safe
health, shared-agent attachment, provider readiness, and tool inventory. It
cannot be edited, disconnected, or removed. Public endpoints, Entra scopes,
and client registration controls remain absent because public MCP ingress is
disabled.

The plugin catalog distinguishes scope from authentication. A private plugin
is owned by one user, uses that user's credentials, and attaches only to that
user's agents. A global plugin is installed for the workspace and is available
to every member; only administrators may add or manage it. Future global
plugins may use a reviewed workspace credential or require each member to make
their own connection, depending on the provider.

The add-plugin and remote MCP installation views are currently a product
preview. They deliberately accept no URL or credential until the isolated
credential broker, OAuth callback handling, tool review, confirmation policy,
and per-agent attachment controls are implemented.

## Application boundaries

The `console/` bundle now owns only login, signup, and pending approval pages.
The role-aware Settings application is built into `workspace/desktop/` and uses
the existing control-plane APIs. No additional service or port is introduced.
Legacy `/account` requests redirect to the desktop with Personalization open.

Nginx authenticates `/workspace` with the control-plane subrequest before
serving the desktop. The same session cookie is then used for the same-origin
Settings API calls.
