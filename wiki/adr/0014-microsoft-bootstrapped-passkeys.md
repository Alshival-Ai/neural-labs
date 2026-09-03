# ADR 0014: Microsoft-bootstrapped passkeys

## Context

Neural Labs supports local passwords and Microsoft Entra sign-in. Requiring a
provider round trip for every login is unnecessary after the deployment has
already established a user's organizational identity, but a passkey must not
become an alternate account-creation or approval path.

WebAuthn ceremonies bind credentials to a relying-party ID and origin. The
control plane therefore needs durable public credential material, short-lived
challenges, replay protection, and an explicit bootstrap rule. Private passkey
keys must remain in the user's authenticator or credential manager.

## Decision

Add discoverable WebAuthn credentials as a login method for existing accounts.
An active user may enroll a passkey only after a Microsoft identity has been
linked to that same account. Passkey enrollment never creates a user, changes
account status, or grants a role.

The control plane derives the relying-party ID from the hostname of the
configured public origin and verifies that exact origin on registration and
authentication. Registration requires a discoverable credential, and both
registration and authentication require authenticator user verification.
Attestation is `none`; Neural Labs does not collect device attestation identity.

PostgreSQL stores the credential ID, public key, WebAuthn user ID, signature
counter, transports, device/backup flags, user label, and timestamps. Ceremony
challenges expire after five minutes and are deleted atomically before
verification so a response cannot be replayed. Enrollment and removal require
an active session, same-origin request, and CSRF token. Authentication failures
are intentionally generic and rate-limited.

## Consequences

- A passkey can authenticate only the existing Microsoft-bootstrapped account
  to which it was enrolled.
- A disabled or rejected account cannot sign in with a valid passkey.
- Changing the deployment hostname changes the relying-party ID; existing
  passkeys will no longer work and must be re-enrolled after Microsoft sign-in.
- Database backups contain passkey public material and counters, never private
  keys. Restoring the database at the same hostname restores passkey login.
- Removing a server record immediately stops Neural Labs from accepting that
  credential. The user's credential manager may retain its local copy.
