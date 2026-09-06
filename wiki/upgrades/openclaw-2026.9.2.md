# OpenClaw 2026.9.2 upgrade record

Reviewed and deployed on 2026-09-06. The workspace now runs **2026.9.2** with
OpenClaw inherited unchanged from its official image. The previous release was
2026.8.2. The control plane did not need replacement for this runtime upgrade.

## Release coordinates

| Component | Deployed value |
| --- | --- |
| OpenClaw | 2026.9.2, published 2026-09-05 |
| Source revision | `3928bad9badfcb6c7d140530435e806fb8092190` |
| Gateway client, protocol and official SMS package | 2026.9.2 |
| Upstream-managed Codex | Upstream plugin declares 0.153.4; launcher unchanged |
| Separate terminal Codex CLI | 0.152.0; independently pinned |
| Node in upstream image | 24.19.0 |

Official base image:

```text
ghcr.io/openclaw/openclaw:2026.9.2@sha256:a8604855b76cd613cbaa45d6db093dc017b09a2faea5dc9cee023fb7ac262250
```

Deployed Neural Labs workspace image:

```text
sha256:4c5f6c08a3f01ad566fbc066cfb224ccd2226a2621334d4131cc49a032825e98
```

All **122,645** `/app` entries in the candidate and running container match the
official base in content, symlink targets, permissions and ownership. Fingerprint:
`3c41e92e6d2071c1f231b362e020b1223cde1d6414124c009594148030ea7227`.

## Compatibility decisions

The retired planning patch no longer needs rebasing. Drafting and implementation
use ordinary chat messages; drafting is advisory, not native Plan-mode tool
restriction. OpenClaw's compiled bundles and managed Codex remain untouched.

The new upstream defaults broaden cross-agent session access and enable Swarm.
Neural Labs explicitly preserves tree visibility, disables ordinary agent-to-agent
access, and disables Swarm. Team collaboration continues through its channel-scoped
MCP. Browser roles still restrict each person to the owned agent and sessions.
See [ADR 0028](../adr/0028-upstream-openclaw-boundary.md).

A new agent can report the shared credential-store path before it has a local
credential. A connected personal account still reports its own agent-local store.
The existing ownership guard remains unchanged: the exact local OAuth profile and
single-profile auth order are required. Inherited main credentials are not treated
as a personal login. Disconnect preserves the other credential owners.

SMS ingress requires an official registry install record. A local-path copy of the
same package failed the upstream trusted-ingress check during rehearsal. Startup
now checks public `plugins inspect` metadata for the exact official npm package
and reinstalls through the native npm installer when necessary. The successful
SMS test used that installation path; no source-path trust bypass was added.

The main agent's Astra model, no-fallback selection and API runtime setting were
preserved. The supported public Astra compatibility definition remains in place;
this upgrade did not reset provider policy or personal accounts.

## Validation and migration evidence

- `make validate` passed with the new package locks and startup checks.
- The final image passed the isolated public CLI batch test: dry-run non-mutation,
  atomic write, invalid-batch rejection and unrelated-setting preservation.
- Synthetic 2026.8.2 state migrated to 2026.9.2 with personal OAuth ownership,
  auth order, transcripts, files and a disabled schedule intact. A fresh agent
  did not acquire another user's credentials; logout left the other owner intact.
- Session tools could read the requester session and could not read another
  agent's history or enumerate its session. Browser tests rejected anonymous
  access, enforced roles for verified proxy identities, allowed owned history,
  hid another user's history and enforced pause/resume. Administrative RPC worked.
- Restoring the pre-upgrade synthetic backup under 2026.8.2 passed the same
  preservation and session-tool checks. No in-place database downgrade is assumed.
- A protected copy of the saved runtime state started successfully on 2026.9.2:
  **five agents, two owned personal OAuth accounts, 18 session keys and seven
  scheduled jobs** retained their ownership/order and enabled states. The rehearsal
  disabled delivery, scheduling and networking; its temporary volume was removed.
- The official npm-installed SMS plugin rejected an invalid signature with
  **HTTP 403** in a network-disabled container. No outbound SMS test was sent.

The repeatable synthetic tests are in `bin/openclaw-upgrade-smoke`; these operator
checks are separate from non-mutating repository validation. The SMS installation
phase downloads the official package before starting an offline Gateway.

## Promotion and recovery

A fresh PostgreSQL and stopped-workspace backup was completed before changing the
deployment's release environment. The recovery record retains the original `.env`,
previous exact image ID, previous runtime versions and backup path. The workspace
was then recreated by immutable image ID without another build or pull.

Deployment doctor passed Gateway, desktop, MCP, control-plane, landing and loopback
binding checks. The new workspace became healthy with zero restarts. The live SMS
account was enabled, configured and running without a channel error. An isolated
headless request to `openai/gpt-6-astra` returned `ASTRA_OK` using the native stored
credential route; it did not deliver to a messaging channel.

Use the protected recovery override and original environment for code rollback.
Restore the matching state backup if required; an image rollback does not undo
SQLite migrations or preserve writes made after the backup. See the
[upgrade guide](../openclaw-upgrades.md) and [backup guide](../backup-restore.md).

Upstream evidence:
[release notes](https://github.com/openclaw/openclaw/releases/tag/v2026.9.2),
[intervening changelog](https://github.com/openclaw/openclaw/blob/v2026.9.2/CHANGELOG.md),
[Codex dependency](https://github.com/openclaw/openclaw/blob/v2026.9.2/extensions/codex/package.json),
[credential-store path selection](https://github.com/openclaw/openclaw/blob/v2026.9.2/src/agents/auth-profiles/paths.ts),
[tool defaults](https://github.com/openclaw/openclaw/blob/v2026.9.2/src/config/types.tools.ts).
