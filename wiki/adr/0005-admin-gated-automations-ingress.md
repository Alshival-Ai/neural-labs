# ADR 0005: Give the desktop Automations app a dedicated admin ingress

- Status: Accepted
- Date: 2026-09-01
- Presentation amended by: ADR 0012

## Context

The Neural Labs desktop now exposes OpenClaw's automation scheduler. Reading
jobs and run history requires `operator.read`; creating, editing, enabling,
running, and removing jobs requires `operator.admin`. Some automation forms
also represent unattended command, script, condition, and stream execution.

The existing `/workspace/neura/socket` is shared by every active workspace
user and is intentionally capped at ordinary read, write, approval, and
question scopes. Adding `operator.admin` to its device auto-approval policy
would permanently grant every authenticated browser administrative control of
OpenClaw and is therefore not acceptable.

## Decision

Expose a second WebSocket ingress at `/workspace/automations/socket`. Nginx
authorizes that route through the control plane's
`/internal/workspace/admin-auth` endpoint, which accepts only an active Neural
Labs administrator. After that check, Nginx overwrites the trusted-proxy
identity with the fixed service identity `neural-labs-automations-admin` and
caps the connection to `operator.read,operator.admin`.

Configure OpenClaw's `gateway.auth.identityScopes` with those same scopes for
that service identity. The Automations protocol client deliberately omits a
device identity and reusable device token. Its requested scopes are therefore
granted only to the live, trusted-proxy-authenticated service connection; no
browser pairing record can retain `operator.admin`. The configured operator
role includes `operator.admin` in its scope ceiling so it does not strip the
explicit identity grant. A role ceiling does not grant a scope by itself, and
the ordinary Neura route remains capped below admin. Keep the general
trusted-proxy device auto-approval scopes and the Neura socket unchanged.
Recycle the Automations connection every five minutes so a disabled or demoted
administrator is checked again by the control plane without waiting for a
browser reload.

This route is subsequently reused by other administrator-only desktop
surfaces, beginning with Skills in ADR 0006. The name is historical; the trust
contract is the control-plane administrator check and fixed
`operator.read,operator.admin` ceiling. Reuse does not grant admin scope to the
ordinary Neura connection.

The original release showed the Automations launcher only to users whose
control-plane session said they were administrators. ADR 0012 later makes the
launcher available for a redacted `operator.read` view while retaining this
administrator ingress as the authoritative boundary for unredacted reads and
every mutation.

## Consequences

- Administrators can use the designed desktop UI for live scheduler state,
  durable run history, creation, editing, enable/pause, manual runs, and job
  removal.
- Regular workspace users cannot open the app and receive HTTP 403 if they try
  the automation WebSocket directly.
- The Automations client stores neither an OpenClaw device identity nor an
  OpenClaw admin credential in the browser.
- Nginx remains the only public Gateway ingress and must continue to overwrite
  all identity and scope headers.
- Installing an updated Nginx configuration remains an explicit operator
  deployment step.
