# Authentication and administrator model

The control plane supports local email/password accounts and optional Microsoft
Entra sign-in. Local authentication is enabled by default. Microsoft web login
and Microsoft-authenticated MCP access are independent switches, but both use
the same Entra app registration.

## Bootstrap and approval

The root `.env` names `NEURAL_LABS_INITIAL_ADMIN_EMAIL`. Until an active
administrator exists, only an identity with that normalized email can claim the
administrator role. Other identities may register, but remain `pending`. The
claim is serialized inside PostgreSQL, so simultaneous requests cannot create
multiple initial administrators. Every later identity also starts as `pending`
until an administrator approves it.

Pending users receive a restricted account-status page and cannot call active
account, workspace, or administrator APIs. Once approved, non-administrators
are sent to the shared workspace. Every active user can review and link sign-in
methods in **Settings → Personalization**. Legacy `/account` requests open that
area in the workspace.

Administrators can approve, reject, disable, promote, or demote accounts. The
database refuses any change that would remove the last active administrator and
invalidates sessions when an account is deactivated.

## Identity linking

Matching email addresses do not silently merge accounts. A signed-in user must
explicitly add another provider from **Settings → Personalization**. The
Microsoft linking flow is bound to that user's live session and a one-time OIDC
transaction. A local password is hashed with Argon2id before storage.

## Sessions and request protection

Sessions are opaque random tokens; only their SHA-256 hashes are stored in
PostgreSQL. Session cookies are `HttpOnly`, `Secure` in HTTPS deployments, and
`SameSite=Lax`. State-changing forms and console API requests also require a
separate CSRF token; the SPA sends it in `X-CSRF-Token`. Login, signup, and
callback attempts are rate-limited in PostgreSQL so limits work across process
restarts.

Role and status checks run on every protected server route. The browser UI is
only a presentation layer and hiding an action does not grant or revoke access.
Console responses contain public user fields and provider names only; password
hashes, external identity subjects, access tokens, client secrets, and private
keys are never serialized.

## Provider lockout protection

At least one web login provider must remain enabled. Before local login can be
disabled, an active administrator must already have a Microsoft identity. MCP
cannot be enabled without an effective Entra configuration. These checks also
run in the database-sensitive administrator paths; the UI is not the security
boundary.

## Single-file environment setup

`NEURAL_LABS_AUTO_SETUP=true` makes the control plane initialize its database
from the root `.env` at startup. The file contains the public origin, intended
initial administrator, provider switches, generated internal secrets, and
optional Entra values. It must be ignored by Git, mode `0600`, and included in
encrypted backups.

Compose passes each service only the values it needs from this one file. The
application containers retain read-only root filesystems. Docker daemon access
can reveal container environment values, so it must be treated as root-level
operator access and never granted to tenant workloads.

## Entra credential ownership

The root `.env` accepts either:

- a client secret; or
- one base64-encoded PEM bundle containing the public certificate and its
  matching private key.

The control plane validates the certificate/key pair and certificate expiry.
Credentials later saved through the administrator rotation form are encrypted
with AES-256-GCM before being written to PostgreSQL.
The encryption key is supplied only to the control plane. The MCP container never
receives the secret or private key. It polls an internal bearer-authenticated
endpoint for public tenant, client, scope, audience, and URL values only.

Saved configuration changed later in the administrator UI takes precedence.
The initial environment configuration uses:

| Variable | Purpose |
|---|---|
| `AZURE_TENANT_ID` | Single accepted Entra tenant |
| `AZURE_CLIENT_ID` | App registration client ID |
| `AZURE_AUTHORITY_HOST` | Microsoft cloud authority; defaults to the public cloud |
| `AZURE_CLIENT_SECRET` | Confidential client secret, when secret mode is used |
| `AZURE_CLIENT_CERTIFICATE_PATH` | PEM certificate/private-key bundle |
| `AZURE_CLIENT_CERTIFICATE_BASE64` | Base64-encoded PEM bundle stored in the protected root `.env` |
| `AZURE_CLIENT_CERTIFICATE_PASSPHRASE` | Optional PEM key passphrase |

Do not bake credentials into an image or tracked Compose file. The real root
`.env` is the only operator-owned configuration file.

## Reopening setup

Setup is permanently closed after a user exists. If onboarding was marked
complete but no user was ever created, an operator can reopen it with:

```bash
docker compose -f deploy/compose/compose.yaml run --rm control-plane \
  node dist/index.js setup-reset
```

This command refuses to run after the instance has been claimed.
