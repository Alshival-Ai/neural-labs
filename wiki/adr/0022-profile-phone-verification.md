# ADR 0022: Private profile phone verification

> Design history: for current instructions, see [Settings](../desktop-settings.md).
> See the [decision index](../maintainer-reference.md#architecture-decision-history) for amendments and related records.

- Status: Accepted (implementation; SMS enablement is an operator step)
- Date: 2026-09-05
- Extended by ADR 0024 for the shared credential source and SMS/MMS channel

## Decision

Settings → Personalization provides a private profile phone number verified by
a six-digit SMS code. This is contact verification only, not a login identity,
account recovery method, MFA, or marketing subscription. An existing verified
number is preserved until its replacement is successfully verified. Numbers
use international `+` notation; the server does not infer a country.

The control plane sends the recipient number and a verification message to
Twilio's fixed HTTPS Messages API. Explicit consent is required for the request.
The browser, workspace agents, team directory, and public user projections never
receive the Twilio credentials or stored OTP digest. Only the signed-in active
owner can read or mutate their phone state. Mutations use the existing session,
same-origin, and CSRF protections; responses are non-cacheable.

Migration 7 adds `user_phones` to the account PostgreSQL database, not the shared
workspace. Codes are generated with cryptographic randomness and stored as an
HMAC bound to the user and challenge using the control-plane master key. Codes
expire after ten minutes and allow five incorrect attempts. Row locking ensures
single use; resends invalidate the preceding challenge and are atomically limited
to once per minute. Persistent hourly request limits apply per user (5), hashed
number (5), hashed IP (20), and instance (200). Verification requests are also
limited to 30 per user per hour. Removing a number does not reset send limits.

A provider-accepted response is not proof of SMS delivery. Rejected sends clear
the pending challenge, retain any verified number, and return a safe retryable
error. No number, code, credential, or raw provider response is added to application
logs. Verification still requires the received code. One verified number can be
linked to one account; conflicts are reported only after proof of possession.

## Operational consequences

- Configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`
  in the protected deployment environment. Compose passes them only to the
  control plane. Leave all three blank to disable sending; partial configuration
  fails startup. The sender must support SMS and the intended destination region.
- Twilio receives the recipient number, sender number, and OTP message. Operators
  must approve the sender/account, applicable messaging setup, opt-out handling,
  and destination permissions before enabling it. Local tests use synthetic SMS;
  no sender credentials are copied from another application automatically.
- Number data is owner-private at the application API boundary, not encrypted
  from database administrators. Verified and pending numbers remain in the account
  database/backups. Success/cancel/remove/new request clears or replaces challenge
  data; expiry prevents verification but does not itself purge the row. Account
  deletion cascades phone-row deletion. Normal backup retention still applies.
- Schema migration runs on the next control-plane start; rebuilding/restarting
  production and enabling the SMS sender remain explicit deployment steps.
