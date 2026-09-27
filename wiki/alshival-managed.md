# Alshival-managed installations

Standalone Neural Labs remains the default. For a deployment managed by an
Alshival portal, use [ADR 0037](adr/0037-alshival-managed-identity.md).

Managed mode needs a fresh PostgreSQL database. Do not reuse a standalone or lab
account database, credentials, or provider state. The portal enrolls an instance
and supplies its immutable workspace UUID, instance UUID, source revision,
hostname, and signing secret. Keep that secret in the control plane only.

Set `NEURAL_LABS_AUTH_MODE=alshival` and the `NEURAL_LABS_PORTAL_*` settings shown
in `.env.example`. The workspace also receives the mode, but does not receive
portal secrets. Local identity setup and the standalone updater are unavailable.
The portal is the only sign-in authority; users launch the desktop there.

Platform operators use `deploy/managed/render.py PRIVATE_REGISTRATION DESTINATION`
to render protected configuration. `--check` validates without writing. The input
contains `runtime`, `workspace`, `instance`, `hostname`, a 40-character `release`,
`images` (digest-pinned `postgres`, `control-plane`, and `workspace`), `storage_root`,
`slot`, `port`, `subnet` (a reserved private /28), `memory_mb`, `cpu`, `portal_secret`,
`database_password`, `master_key`, `control_token`, and `mcp_token`. Generate unique
secrets once and preserve them across restarts. `master_key` is 32 random bytes
encoded as 64 hexadecimal characters. Optional `documents_name` is `documents`
or `workspace`, matching the registered host. Optional `turn` supplies `urls`
and `secret` for the operator's existing TURN service.

The destination must be new. Place the reviewed output under a root-owned host
configuration directory, register it through the Alshival host worker, and use
that worker for startup, health, leases, and cleanup. Do not run the standalone
updater or configure automatic Compose restarts. The complete stack requires at
least 4 GiB RAM and two reserved CPUs. Capacity and native architecture acceptance
are separate from syntactic configuration validation.

An unauthenticated workspace visit returns to Alshival. A successful launch must
produce a host-only secure session cookie without putting credentials into URLs.
Acceptance includes replay, expired login, removed member, downgraded role, lost
coverage, unavailable portal, stopped host lease, and retained Documents API access.
Optional provider consent remains an owner action; a healthy desktop does not prove
that a connected AI provider can complete a request.

## Public app namespace

An Alshival operator may provision `*.WORKSPACE.alshival.cloud` after the managed
instance is registered. Its separate certificate and app gateway must be verified
before a workspace manager can enable public web access in Services. The host's
private Nginx ingress includes a loopback-only `__alshival_app` route to this
instance's workspace container. Keep that reviewed route and the accepted workspace
image together during upgrades.

An app name maps to a loopback process through
`/workspace/.neural-labs/public-apps.json`, for example
`{"apps":{"website1":{"port":30000}}}`. Only ports 30000–30999 are admitted.
Managed terminals receive `NEURAL_LABS_APP_DOMAIN` from the operator registration;
the future deploy skill should form `https://APP.$NEURAL_LABS_APP_DOMAIN` from that
value rather than embed a customer hostname or derive one from an editable name.
The file does not launch or supervise the process; the future deploy skill must do
that and verify the public URL. Public web access grants anonymous visitors the
app's own content. Do not put portal credentials in an app or rely on portal
membership checks for its requests. See [ADR 0038](adr/0038-managed-public-app-ingress.md).
