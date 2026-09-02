# Skills desktop app

Skills is the Neural Labs desktop client for OpenClaw's effective skill catalog,
Skill Workshop, and ClawHub registry. OpenClaw remains the source of truth;
Neural Labs does not copy skill state into a second database.

Every approved workspace developer can open Skills and:

- inspect the main agent's effective catalog, including source precedence,
  eligibility, missing binaries/environment/configuration, invocation policy,
  and recorded usage;
- load the exact current `SKILL.md` card through `skills.skillCard`;
- inspect pending and historical Skill Workshop proposals;
- search ClawHub and load registry publisher, release, platform, and changelog
  detail; and
- place a skill's stable `$skill_name` reference into the active Neura composer.

Administrators can additionally:

- enable or disable a skill through `skills.update`;
- create Workshop create/update proposals;
- run proposal evaluators and apply, reject, or quarantine an exact inspected
  revision;
- ask Neura to help revise a proposal;
- scan earlier sessions for reusable skill ideas; and
- install a ClawHub result into the shared main-agent workspace.

Proposal creation never writes a live `SKILL.md`. OpenClaw writes a
`PROPOSAL.md`, scans it, and requires a separate apply transition. Apply and
reject use the exact revision hash returned by a fresh
`skills.proposals.inspect`, so a stale browser cannot silently act on a newer
draft.

## Public/private boundary

Team skills live only in `/home/node/workspace/skills` in the persistent
workspace volume. Do not create them under the public source repository's
top-level `skills/` directory, copy them into an image build context, or attach
a Git remote to `/home/node/workspace`.

The runtime workspace carries a deny-by-default `.gitignore` and is not itself
a Git repository. Source code for a reusable public skill must be developed in
a deliberately separate public repository and copied in only after review.
Credentials remain in the root deployment `.env`, provider stores, or another
approved secret store; a `SKILL.md`, support script, example, fixture, or log
must never contain a credential.

## Authorization

Read operations use the ordinary authenticated `/workspace/neura/socket` and
its `operator.read` scope. The browser never receives an administrator scope
because the current account says it is an administrator.

Mutations use the existing `/workspace/automations/socket` administrator
ingress. Despite its historical path name, that ingress is the shared Neural
Labs desktop administrator channel: Nginx first calls the control plane's
active-administrator check, then overwrites identity and scope headers with a
fixed trusted-proxy identity capped at `operator.read,operator.admin`.
The admin client has no OpenClaw device pairing or reusable browser token;
OpenClaw, not a React visibility check, enforces the final method scope on the
live trusted-proxy connection.

The admin WebSocket is recycled every five minutes so account disablement or
demotion is rechecked. Regular users see a view-only catalog and cannot use the
admin WebSocket directly.

See [ADR 0006](adr/0006-skills-permission-split.md) for this authorization
split and [ADR 0005](adr/0005-admin-gated-automations-ingress.md) for the
underlying admin ingress.

## Refresh behavior

Skill-related Gateway events trigger a debounced refresh. A 30-second
reconciliation poll catches filesystem watcher changes and older Gateway
versions that do not emit a relevant client event. Skill Card and proposal
body content loads lazily when selected to avoid transferring every bundled
skill on every refresh.

ClawHub results are registry data, not an endorsement. Unscanned sources remain
marked unscanned, ordinary third-party results require review, and official
publisher status is shown separately from a security-scan claim. OpenClaw
still performs its install trust-envelope and policy checks when an
administrator installs a release.

## Current protocol boundaries

- Gateway installs target the selected agent workspace. The UI therefore does
  not offer a personal/global install target.
- OpenClaw exposes the current Skill Card but not arbitrary installed support
  file reads on this surface.
- Skill configuration controls enablement. Agent allowlists, credentials,
  tool permissions, and host shell authorization remain separate boundaries.
- New sessions receive refreshed skill snapshots; an already-running session
  retains its pinned snapshot.
