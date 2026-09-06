# ADR 0029: Settings-managed provider credentials

Status: Accepted, implemented locally; deployment pending.
Date: 2026-09-06

## Context

Plugin setup cards need administrator-managed keys for Google Maps, KLIPY, and
Pexels. The workspace-local MCP and Team Terminal GIF picker must use changes
without restarting. Environment-only configuration cannot represent an explicit
administrator disconnect safely.

## Decision

Reuse the existing `plugin_connections` table and `CredentialCipher` encryption
for rows `provider-google-maps`, `provider-klipy`, and `provider-pexels`. No schema
migration is required. Saved keys are encrypted, never echoed in browser APIs,
and never included in audits. Audits contain action, provider ID, and outcome.

Active members receive a safe catalog and read-only details. Mutations and
connection checks require an active administrator session, same-origin checks,
and the session CSRF token. Provider IDs are a fixed allowlist. Check requests
are rate limited. Save replaces a key and increments its revision; disconnect
removes encrypted credentials and writes a disabled override. Only explicit
inheritance restores deployment configuration. An absent row inherits by default.
Checks are tied to a revision and cannot overwrite the result of a newer save.

The existing internal control-plane boundary gains
`GET /internal/plugins/providers/config`, protected by the workspace control
Bearer token and `Cache-Control: no-store`. Only this internal response includes
decrypted keys. It serves the trusted workspace processes, with no browser route
or new ingress port. The workspace retains its existing shared-user trust model;
this does not isolate provider credentials from privileged workspace users.

Both workspace HTTP and local MCP processes refresh every 15 seconds with a
five-second timeout, bounded payload, and no redirects. They retain configuration
only in memory and lease the last successful response for 60 seconds. Startup
failure and lease expiry fail closed, including for inherited environment keys.
New MCP requests receive immutable configuration snapshots; running requests may
complete using an earlier key. Terminal GIF searches use the live configuration,
clear cached selection tokens after changes, and reject searches spanning a
revision change. KLIPY application status requires both processes to agree.

Internal workspace status and check endpoints use the existing Bearer boundary.
Checks refresh configuration and make bounded read-only requests to fixed Google,
KLIPY, or Pexels hosts. Google reports Places and Geocoding independently. Raw
provider errors and URLs are never forwarded to the browser. Health reports
availability and revision only, never secrets. Existing Twilio configuration and
locked Neural Labs Tools behavior remain intact.

## Consequences and validation

A control-plane outage longer than one minute temporarily disables provider tools.
Disconnect takes effect on the next successful refresh, or when the lease expires;
it does not cancel already running requests. Environment changes still require
operator-managed rollout, while Settings changes do not require a restart.

Tests cover encrypted storage, inheritance and disconnect, stale-check protection,
admin/CSRF/token boundaries, partial checks, outage expiry, live MCP tool inventory,
GIF key changes, and browser setup at desktop and narrow/short phone sizes.
Provider requests in tests use fixtures; no real key or paid provider call is needed.
