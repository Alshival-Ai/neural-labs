# Settings

Neural Labs settings live inside the shared desktop at `/workspace`. Every
active user receives the **Settings** cog in the dock. The account menu is kept
small and contains only the sign-out action.

Members open Settings with **Personalization**, **Security**, **Model Provider**,
and **Plugins**. Personalization controls device-local desktop font size, account
identity, and notification preferences. Security manages personal sign-in methods,
passkeys, and verified phone numbers. Model Provider connects or pauses the personal
ChatGPT account and configures private Neura model/reasoning defaults. Plugins separates private,
user-owned connections from global workspace capabilities. Administrators
receive those same areas plus the control-plane areas below.

When that personal ChatGPT account is disconnected or paused, the desktop shows a
clickable onboarding toast after account bootstrap. Selecting it opens or
focuses Settings and switches directly to Model Provider.

The old `/admin` console is retired. Requests to `/admin` or any nested legacy
path redirect active users to `/workspace`.

## Settings areas

**Personal → Security** provides a private phone-number card: enter an international
number, agree to a verification SMS, and submit the six-digit code. The card
supports code autofill, resend cooldown, expiry/attempt errors, replacing the
number without losing the existing verification, and confirmed removal. Pending
verification is restored when Settings reopens. This does not enable phone login,
recovery, or marketing messages.

Phone verification requires the administrator's Twilio SMS/MMS connection in
**Settings → Plugins**. It does not opt you into proactive agent messages;
those require the separate Personalization preference.

| Area | Purpose |
|---|---|
| Personalization | Per-user desktop font size, account identity, notification preferences, and sign out |
| Security | Personal sign-in methods, passkeys, and verified phone management |
| Model Provider | Personal ChatGPT connection, follow-latest or pinned agent model, supported reasoning levels, and Claude availability notice |
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

Model Provider uses a parallel device-code controller scoped to the signed-in
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

## Plugins and SMS

The global **Twilio SMS/MMS** channel uses one administrator-managed Twilio
account and sender number. Credentials are entered manually, validated with a
read-only Twilio request, and encrypted by the control plane. Neural Labs shows
the exact inbound webhook URL and setup steps but does not change the Twilio
Console in v1. Verified phone numbers are the inbound allowlist and route to
that member's private Neura. Each member must separately enable **Agent SMS/MMS
updates** in Personalization before an agent can send proactive messages to
them. Agent tools accept only a workspace handle or user ID, never an arbitrary
phone number.

The workspace image pins the official `@openclaw/sms` package to the same
reviewed release as OpenClaw (see the [release manifest](../workspace/openclaw-release.json)). In Twilio, configure the sender number's **A
message comes in** webhook as HTTP POST to the URL shown in Settings. SMS and
MMS callbacks are signature-validated by the channel plugin.

The add-plugin and remote MCP installation views are currently a product
preview. They deliberately accept no URL or credential until the isolated
credential broker, OAuth callback handling, tool review, confirmation policy,
and per-agent attachment controls are implemented.

## Plugin cards and API keys

Plugins opens on compact cards for **Neural Labs Tools**, **Twilio SMS/MMS**,
**Google Maps**, **KLIPY**, and **Pexels**. Select a card for its connection details;
**All plugins** returns to the selected scope filter. Every member can inspect
status. Administrators manage the shared connections. Neural Labs Tools remains
a locked system plugin, and Add plugin remains a preview for future installations.

For Google Maps, KLIPY, or Pexels, enter an API key and select **Save key**, then
**Check connection** once the configuration has applied. Saved keys are encrypted
and never returned to the browser. Google Maps uses one key with separate Places
and Geocoding checks, so a partial setup reports which capability needs attention.
Connection checks make small read-only provider requests, which may consume quota.

Saved keys take priority over deployment environment settings. **Disconnect**
removes the saved key and disables that service, including any environment key.
**Use deployment configuration** explicitly removes the Settings override and
restores environment-based configuration. Both actions require confirmation.
Changes normally apply within 15 seconds without restarting the workspace;
status distinguishes applying, configured but unchecked, connected, and failed
checks. During a configuration-service outage, tools retain their last confirmed
configuration for at most 60 seconds, then become unavailable until it recovers.

Phone verification stays in Security; the **Agent SMS/MMS updates** preference
stays in Personalization. Adding a phone does not opt into notifications. Open
Settings windows refresh phone state after a change, including removal.
See [ADR 0029](adr/0029-settings-provider-credentials.md) for credential handling
and runtime propagation.

## Application boundaries

### Personal model provider cards

OpenAI cards and their detail view include **Refresh connection**. This requests
the owner's catalog with native refresh enabled and rechecks connection status;
it does not reinstall software, disconnect, resume paused access, or save policy
changes. Draft model/reasoning selections survive refresh. Stale cached responses
are reported as failed refreshes rather than success. The catalog shows the
verified Codex runtime version and last-check time. Runtime software updates
remain an operator-managed, pinned-image release operation.

Model Provider opens on OpenAI and Claude cards. Select a card to open its
connection settings; Back to providers returns to the overview. Claude remains
unavailable until its subscription integration is supported. Connected personal
accounts expose default provider, model and supported reasoning controls above
the cards. The model selector offers a latest-compatible policy or an explicit
pin; conversation and automation overrides are unchanged.

OpenAI's Disconnect action requires confirmation and removes the personal native
auth profile, unlike Pause, which retains it. The server derives the owner from
the authenticated session and requires same-origin CSRF protection. Pending
login processes must stop before logout, account actions are serialized, and
logout is restricted to that owner's agent and exact profile ID. Failed removal
is reported without exposing native command output. Chats and model preferences
are retained; workspace and Team credentials are not disconnected. Reconnection
uses the existing ChatGPT device sign-in. Production accounts are not exercised
by the mocked UI, API, runtime, or responsive browser tests.

The `console/` bundle now owns only login, signup, and pending approval pages.
The role-aware Settings application is built into `workspace/desktop/` and uses
the existing control-plane APIs. No additional service or port is introduced.
Legacy `/account` requests and account-link callbacks open Security in the desktop.
`/workspace?settings=security` opens it directly; existing
`?settings=personalization` links continue to open Personalization.

Nginx authenticates `/workspace` with the control-plane subrequest before
serving the desktop. The same session cookie is then used for the same-origin
Settings API calls.
