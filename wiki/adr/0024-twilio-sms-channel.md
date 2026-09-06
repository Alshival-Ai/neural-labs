# ADR 0024: Global Twilio SMS/MMS channel

- Status: Accepted (deployment and Twilio Console configuration are operator steps)
- Date: 2026-09-05
- Extends ADR 0022

## Decision

Neural Labs exposes a fixed global **Twilio SMS/MMS** plugin managed by workspace
administrators. One Twilio account and sender number serve the workspace. The
control plane validates credentials and the owned sender with read-only Twilio
API calls, encrypts the Auth Token with the existing control-plane master key,
and never returns it to browsers or agents. Existing `TWILIO_*` environment
values are a migration fallback; a saved or explicitly disabled Settings row
takes precedence.

The workspace pins `@openclaw/sms@2026.8.2`, matching the pinned OpenClaw
runtime. Startup installs it with the native official npm installer and retains
the installation record in the persistent OpenClaw volume. A generic load path
cannot use the trusted channel ingress queue. Installation uses umask 022;
OpenClaw correctly rejects world-writable plugin artifacts. The control plane
gives its protected runtime endpoint the effective
channel configuration and all active users with verified phone numbers. OpenClaw
uses those numbers as `dmPolicy: allowlist` peers and binds each direct peer to
that user's deterministic personal Neura agent. Unknown, pending, removed, and
disabled-user numbers are not accepted. Personal model credentials are not
borrowed from the workspace or another member.

Nginx exposes only `/webhooks/twilio/sms` and its plugin-owned subpaths to the
Gateway. Twilio request signatures remain enabled. The administrator must enter
the exact HTTPS webhook shown in Settings as an HTTP POST callback in Twilio;
v1 does not mutate Twilio Console configuration. Signed inbound MMS and native
channel replies use the official plugin.

Proactive delivery is not a platform notification system. The local Neural Labs
Tools MCP registers `notify_workspace_user`, which an agent may use when a prompt
or automation calls for an update. It accepts one workspace `@handle` or user ID,
bounded text, and optional HTTPS media URLs. The control plane resolves the
recipient server-side and sends only when that active member has a verified
number and has enabled **Agent SMS/MMS updates** in Personalization. The opt-in
defaults off and is cleared whenever the verified number changes or is removed.
Arbitrary destination numbers are not part of the tool or internal API.

## Consequences

- The plugin connection, member allowlist, opt-in, and sender are global
  workspace state. Account-level Twilio connections and Messaging Services are
  outside v1.
- Phone verification and agent delivery share the same effective credential
  source. Secrets remain in the control plane and the trusted Gateway channel
  environment, and are removed from agent, terminal, and workspace MCP process
  environments.
- Connection changes and verified-member allowlist changes cause a bounded
  workspace restart so the Gateway receives a fresh environment secret and
  channel routing snapshot.
- SMS/MMS contents and media URLs leave Neural Labs for Twilio and carriers.
  Delivery is rate-limited, but administrators remain responsible for sender
  registration, consent, regional rules, opt-out handling, and Twilio billing.
- Repository validation uses synthetic provider responses. Deployment requires
  database and OpenClaw-state backup, image rebuild, migration 9, Nginx review,
  coordinated restart, Twilio Console setup, and real inbound/outbound smoke
  tests with a verified opted-in member.

Reference: [OpenClaw SMS channel documentation](https://docs.openclaw.ai/channels/sms).
