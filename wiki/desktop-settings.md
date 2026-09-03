# Desktop settings

Neural Labs settings live inside the shared desktop at `/workspace`. Every
active user receives the **Settings** cog in the dock. The account menu is kept
small and contains only the sign-out action.

Members open a personal version of Settings with one **Personalization** area.
It controls their device-local desktop font size, shows their account identity,
lets them link available sign-in methods, and connects or pauses the personal
ChatGPT account used by interactive Neura. Administrators receive the same
Personalization area plus the control-plane areas below.

The old `/admin` console is retired. Requests to `/admin` or any nested legacy
path redirect active users to `/workspace`.

## Settings areas

| Area | Purpose |
|---|---|
| Personalization | Per-user desktop font size, account identity, linked sign-in methods, personal Neura ChatGPT connection, and sign out |
| Overview | Account counts, authentication state, MCP state, runtime health, and recent audit events |
| Users | User approval, rejection, activation, disabling, and Admin/User role assignment |
| Authentication | Local and Microsoft login enablement plus Entra secret or certificate rotation |
| MCP | Live workspace-local MCP health, shared-agent attachment, provider readiness, and registered tools |
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

The MCP area is read-only in V1. It reports the loopback provider service that
the workspace attaches globally to shared OpenClaw agents as
`neural-labs-tools`. Public endpoints, Entra scopes, and client registration
controls are intentionally absent because public MCP ingress is disabled.

## Application boundaries

The `console/` bundle now owns only login, signup, and pending approval pages.
The role-aware Settings application is built into `workspace/desktop/` and uses
the existing control-plane APIs. No additional service or port is introduced.
Legacy `/account` requests redirect to the desktop with Personalization open.

Nginx authenticates `/workspace` with the control-plane subrequest before
serving the desktop. The same session cookie is then used for the same-origin
Settings API calls.
