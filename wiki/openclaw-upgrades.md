# Updating the OpenClaw runtime

Neural Labs upgrades OpenClaw as a tested workspace image. Do not run
`openclaw update`, replace npm packages, or edit compiled bundles inside a running
workspace: those changes bypass the reviewed image, browser clients and SMS plugin and disappear when the container is recreated.

The current assessment is [OpenClaw 2026.9.5](upgrades/openclaw-2026.9.5.md).
Discovery and preparation do not deploy a release.
The [upstream boundary verification](upgrades/upstream-boundary-2026-09-06.md)
records the unmodified 2026.8.2 application tree in the refactored image.

## Release contract

[workspace/openclaw-release.json](../workspace/openclaw-release.json) is the
reviewed set of versions. The remaining pin locations are checked against it:

| Component | Where it is enforced |
| --- | --- |
| OpenClaw image tag and immutable digest | Containerfile, Compose, `.env.example`, deployment preflight |
| Exact upstream source revision | Upstream image provenance and runtime version check |
| Unmodified upstream application | Empty patch inventory, Containerfile guard, image tree comparison |
| Gateway client and protocol packages | Workspace and desktop package manifests and lockfiles |
| Official SMS plugin | Workspace package lock and startup installer, using the release version |
| Terminal Codex CLI | Separate pin, Containerfile, Compose and runtime verification; upstream manages its own Codex |
| Public config mutation interface | `native-config-batch.mjs`, CLI contract smoke test |

The metadata is a consistency check, not a claim that an untested release is
compatible. Image digest and source commit must be verified against upstream
release evidence. A version environment variable does not upgrade a binary;
startup checks the installed CLI before provisioning or channel installation.
Historical release notes and test examples are not rewritten by pin syncing.

## Discover and review

These commands do not change a running service or edit release pins:

```bash
bin/neural-labs workspace check-update
node bin/openclaw-release.mjs inspect 2026.9.2
bin/neural-labs workspace release-check
```

`inspect` reads GitHub and the npm registry and reports the source commit,
publication date, prerelease status, engines, and integrity metadata for the
runtime and three integration packages. Network failure fails the command; it
never silently falls back to a guessed version. `release-check` is offline and
also checks version overrides in the local `.env` when it exists. It reads only
release keys from that file and never prints credentials.

Verify the candidate image separately, including the image's source-revision
label after pulling it:

```bash
docker buildx imagetools inspect ghcr.io/openclaw/openclaw:2026.9.2
```

Read every intervening release's migration notes when skipping releases. Review
configuration and SQLite migrations, role and session policy defaults, provider
credential selection, plugin installation, scheduler/delivery changes, Node
requirements, and the managed Codex package. Check upstream source for contracts
that release notes do not describe.

Use a clean checkout or extracted, provenance-verified source archive outside
this repository to inspect runtime requirements:

```bash
node bin/openclaw-release.mjs check-source /absolute/path/to/openclaw-source
```

This reads package metadata only. It reports the candidate Node requirement and
upstream Codex dependency separately from the independently installed terminal
CLI. There are no downstream patches to rebase or upstream sources to compile.
Neural Labs customizations belong in its app, public configuration, skills or
MCP tools; see [ADR 0028](adr/0028-upstream-openclaw-boundary.md).

## Prepare a release change

Use a dedicated release checkout when the working tree contains unrelated work.
In that checkout, update the manifest's version, image digest, source revision,
and matching integration packages together. Review the terminal Codex version
independently; do not override OpenClaw’s bundled launcher. Keep `patches: []`.
Keep credentials and tenant state outside the checkout.

```bash
node bin/openclaw-release.mjs sync
npm --prefix workspace install --package-lock-only --ignore-scripts
npm --prefix workspace/desktop install --package-lock-only --ignore-scripts
npm --prefix workspace ci
npm --prefix workspace/desktop ci
node bin/openclaw-release.mjs check
make validate
```

`sync` updates only the public pin locations and package manifests. It deliberately
does not edit `.env`, lockfiles or running services. Review the
lockfile changes after resolving dependencies. `make validate` is offline with
respect to release discovery and must remain non-mutating for the deployment.

Build the candidate with `.env.example`, using a distinct local image tag and
an explicit override file outside the public tree. A build includes desktop
compilation, MCP validation and the actual OpenClaw version check. OpenClaw's
`/app` tree is inherited unchanged, including plugins and managed binaries.
Compare the base with the resulting immutable local image ID or registry digest:

```bash
sudo bin/openclaw-compare-image BASE_IMAGE@sha256:DIGEST sha256:CANDIDATE_IMAGE_ID
```

Both images must already exist locally. The check runs two temporary read-only,
network-disabled containers with only the probe file mounted. It compares every
`/app` path, file content, symlink target, permission and owner, ignoring timestamps.
It fails on differences. This operator check is separate from `make validate`;
validation itself never creates containers or changes host services.

## Candidate acceptance

Keep candidate tests separate from production. Use a different Compose project,
fresh volumes, synthetic identities, test ports bound to loopback, and no live
Twilio credentials. Do not point a candidate at the production volumes or webhook.
Keeping the runtime unchanged removes patch rebases; integration and migration
checks are still required.

| Area | Evidence required before promotion |
| --- | --- |
| Build and CLI | Unmodified `/app`; exact runtime/source and terminal CLI versions; config batch dry run and actual write on synthetic state; no internal hashed-bundle imports |
| Authentication | Anonymous and identity-less requests rejected; administrator access works; each personal agent uses its own account |
| Isolation | Browser RPC and agent tools cannot read another user's private sessions or credentials; Team remains explicitly scoped |
| Chat and planning | Existing history, streaming, cancellation, tools, app-level drafting/implementation handoff and reconnects work with the new protocol |
| Providers | Account-scoped catalogs agree with real model probes; Astra and selected effort work on the intended API/OAuth route |
| Automations | Existing schedules and disabled states survive; heartbeat errors do not generate repeated unwanted notifications |
| SMS/MMS | Matching official plugin installs from its trusted installation record; allowlist and signed webhook rejection verified; outbound transport mocked |
| Storage | Representative synthetic old-version state migrates with sessions, files, auth references and schedules intact |
| Recovery | Candidate failure leaves a usable recovery set; restore exercised on isolated state; post-upgrade writes are accounted for |

Run the repeatable operator acceptance suite with the previous base image and
the candidate **Neural Labs workspace** image (both must exist locally):

```bash
sudo bin/openclaw-upgrade-smoke BASE_IMAGE@sha256:DIGEST sha256:CANDIDATE_IMAGE_ID
```

It creates and removes its own synthetic volumes, seeds old-version OAuth
fixtures/history/disabled schedules, upgrades them, tests session-tool and
browser-role isolation, and restores the pre-upgrade backup under the old image.
The SMS installation phase downloads the pinned official npm package without
starting a Gateway. All Gateway and webhook tests run with networking disabled;
the webhook test sends no outbound SMS. Local-path plugin installs cannot test
trusted SMS ingress. This suite is never part of non-mutating `make validate`.

A public CLI smoke test can run separately in a container with no network and
temporary state. The helper in `tests/openclaw-cli-smoke.mjs` makes no model
requests and verifies the public transaction contract. This operator test is
separate from `make validate`.

```bash
sudo bin/openclaw-smoke-test ghcr.io/openclaw/openclaw:2026.9.2@sha256:a8604855b76cd613cbaa45d6db093dc017b09a2faea5dc9cee023fb7ac262250
```

The image must already be pulled. The command accepts an immutable digest only,
mounts just the two test files read-only, uses a read-only root filesystem and
temporary scratch storage, and disables networking. Run it against both the
current application image and the candidate; it does not load live configuration.

Before state migration rehearsal using real data, create a protected copy in an
operator-controlled location; prevent network access and SMS delivery. Never
commit state fixtures derived from real users. Record which schema migrations
ran and whether the old image can read that migrated state. Do not assume it can.

## Promote and recover

Save the currently deployed release values and exact image identifiers before
changing deployment-local version overrides. Keep the release record, matching
configuration and recovery files together outside the repository. Promote the
built application image by immutable digest; the upstream base digest alone does
not identify the complete Neural Labs application image.

After reviewing the candidate evidence, an operator updates the three runtime
keys in `.env` to the reviewed release. Run `release-check` again. The existing
operator update commands now check pins and build before stopping services:

```bash
sudo env "PATH=$PATH" bin/neural-labs workspace update
# Use a coordinated application update when control-plane contracts changed:
sudo env "PATH=$PATH" bin/neural-labs update
```

These commands preserve the operator's Node installation path for release
validation; this host installs Node through nvm, outside sudo's default PATH.

The workspace updater captures the running container's exact image before a
mutable tag is rebuilt. It builds first, creates the normal recovery backup,
records the previous image and its runtime environment versions in a protected
`workspace-update-TIMESTAMP/rollback-images.yaml`, and recreates without building
or pulling again. Build or backup failure prevents replacement. Health checks
are necessary but are not substitutes for the acceptance matrix.

To roll application code back, use the matching protected Compose image override
with `--no-build --pull never --no-deps`. Review the old release environment too.
The record identifies code; it does not reverse a migration. If the old runtime
cannot read the new state, stop and use the tested full recovery procedure in
[Backup and restore](backup-restore.md). A state restore discards later writes;
there is no automatic state downgrade or automatic restore on health failure.

Upstream references: [Updating OpenClaw](https://docs.openclaw.ai/install/updating),
[Docker deployment](https://docs.openclaw.ai/install/docker).

## Automatic terminal Codex updates

Use **Settings → Updates** to enable daily stable-release checks. On first
initialization, the control plane imports `NEURAL_LABS_CODEX_AUTO_UPDATE` from
the deployment environment; later changes use the saved administrator policy.
New terminal CLI launches use a successfully installed and version-verified
update without restarting existing sessions or the workspace. The pinned image
CLI remains the fallback. Disabling automatic updates keeps the installed
version and stops future checks; it does not roll the CLI back.

Updates install under `/home/node/.local/share/neural-labs/codex-terminal`, use
the official npm registry with lifecycle scripts disabled, and activate through
an atomic symlink. Failed checks/downloads keep the existing selection and retry
the next day. Prior installations are retained. Workspace Settings reports the
selected CLI version; `NEURAL_LABS_CODEX_VERSION` identifies the image fallback.

This option affects the Neural Labs Terminal app's `codex` command. Explicit
`/usr/local/bin/codex` calls continue using the pinned image CLI. OpenClaw's
managed app-server and the custom app-server command override remain separate
and must track the compatible OpenClaw plugin version. See
[ADR 0035](adr/0035-terminal-codex-automatic-updates.md).

## SMS reply recovery on 2026.9.2

A valid personal OAuth login can still fail with **Explicit auth order for openai
has no usable profiles** when `models.providers.openai` sets a provider-wide
`api: openai-responses` and the OpenAI Platform base URL. Inspect the affected
agent with `openclaw models status --agent AGENT_ID --json`. An API-key route
combined with a personal OAuth-only order is a routing mismatch, not necessarily
an expired login. Keep transport/base-URL overrides on the specific API model
rows that need them, allowing other models to select their subscription route.
Validate changes with the public CLI and retain the personal auth order.

The 2026.9.2 image was also observed to contain the managed Codex npm wrapper
without its native executable. A package version check alone does not catch this.
The Codex plugin in that release expects app-server **0.153.4**, independently of
the terminal CLI pin. An operator recovery installed that exact official package
under `/home/node/.local/share/neural-labs/codex-app-server` and configured the
supported `plugins.entries.codex.config.appServer.command` setting to
`/home/node/.local/share/neural-labs/codex-app-server/node_modules/.bin/codex`.
This installs a separate executable in the persistent workspace; it does not
replace the terminal CLI or alter `/app`. The directory is covered by the normal
workspace-home backup. Recheck the upstream app-server pin and compatibility on
every upgrade; do not carry this version forward blindly.

Verify a real isolated agent reply using the affected personal credentials after
repair, as well as model-status readiness. For SMS, verify the native channel's
inbound reply and delivery receipt with an explicitly authorized test. Gateway
operator-client identity failures are separate from model authentication; do not
relax user/role policies to work around them.

Administrator policy, reviewed release publication and host maintenance are documented in [Workspace updates](workspace-updates.md).
