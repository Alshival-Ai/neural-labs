# Workspace updates

The task-graph release includes a destructive PostgreSQL migration: legacy Team Chat channels/messages and internal task content are removed on every installation upgrading from that schema. Private agent conversations remain intact. See [Workspace task graph](project-management.md). Rehearse this schema boundary under the maintenance gate before promotion; older additive-migration evidence does not cover it. Never restore a pre-upgrade database over accepted new writes.

Migration 26 adds project-board ownership and separate status catalogs. It is additive and retains existing unassigned records on the original Workspace board. This does not remove the earlier migration 22 boundary for installations that have not crossed it.

Migration 27 adds source edit clocks to graph records and leaves existing content intact. The optional connection-authenticated graph bridge requires a compatible integrating service.

Migration 28 adds optional external collaboration credentials, private session bindings, and renewable operation leases. It is additive and does not change the earlier destructive migration boundary. See [External agent collaboration](external-agent-collaboration.md).

Connected paper cards add resource homes in existing item JSON and reuse the existing relationship table. No new SQL migration is required. Existing native installations retain their database binding and all items; upgrades from before migration 28 still apply that additive migration.

Settings → Updates controls reviewed Neural Labs runtime releases. Codex and
Claude Code are pinned together with their tested protocol adapters in
`workspace/native/release.json`. Private Terminal and Neura use the same native
versions. Provider executables do not update independently in production.

Automatic runtime installation is opt-in. The default maintenance window is
Sunday 03:00–05:00 America/Chicago. Active chats, automations, Terminal sessions,
editors, uploads, and notification sends defer installation. “Install now when
idle” bypasses the calendar window but still requires verified inactivity.

## First native migration

The first native release is **operator-only**. It is not an automatic replacement
for an existing Gateway installation. `workspace/update-release-policy.json`
currently declares no certified automatic migration baseline. The native
implementation remains under acceptance testing; source builds are not evidence
that an existing deployment is ready to activate.

Preserve the original deployment identity, volumes, credentials, and complete
history. Gate new work, pause the old scheduler, drain active runs, and take
consistent recovery copies belonging to that same workspace. Inventory and import
with `bin/native-migration.mjs`; inspect its hash and record-count report. The
import does not activate jobs, change credentials, reset chats, or move packages
into their live paths. Those require the reviewed operator migration procedure.
Never treat a successful import alone as activation readiness.

Record chat-reset policy separately for each workspace. A pilot's reset consent
does not apply to customer deployments. Keep notification subscriptions and
outbox state in PostgreSQL, and do not resend historical receipts. Missing native
credentials or incompatible execution policies retain visible job holds without
changing their intended enabled states. Retain legacy volumes separately after
cutover; the production native runtime mounts only its workspace home.

## Native host preparation

The generic updater supports Linux amd64 and ARM64 with systemd, Python 3.11+,
Docker Compose supporting `!override`, and GitHub CLI artifact verification. Its
standard layout uses control-plane port 4174 and desktop front/backend ports
4181/4183. Custom topology requires a corresponding host adapter. Managed hosting
must use its existing host worker and migration machinery.

After a native cutover, later managed releases keep the same PostgreSQL database
binding. The new source SHA and immutable image digest change; the existing
database and accepted workspace writes remain in place.

First perform the [native security preparation](../deploy/security/README.md).
This installs separate native AppArmor and seccomp profiles without restarting
Docker or modifying existing volumes. Do not disable host security controls to
make a failing provider namespace probe pass.

After a native installation has passed preservation and readiness:

```bash
sudo python3 deploy/updater/install.py prepare --repository "$PWD" --confirm
```

Preparation generates a dedicated worker token in private `.env`, captures a
root-owned Compose descriptor, and installs inactive host services. Configuration
is `/etc/neural-labs/updater.json`. Journals, releases, and recovery copies live
under `/var/lib/neural-labs/updater`, or
`/var/snap/docker/common/neural-labs-updater` for Snap Docker. Registry and GitHub
credentials stay on the host, outside tenant containers.

Deploy the matching control plane and native runtime through the operator
workflow. Once idle, activate the prepared updater:

```bash
sudo python3 /opt/neural-labs-updater/install.py activate --confirm
```

Activation gates work, checks activity again, moves the native listener behind
the host proxy, verifies the selected deployment, and resumes work. Failures
retain protected state for operator recovery. Do not bypass an active managed
Compose descriptor with a second project or delete volumes to repair a failure.

## Release identity and compatibility

The native deployment manifest has schema 2. It records the exact source commit,
immutable multi-platform image digest, native runtime/Codex/Claude versions,
pinned Linux base, both supported architectures, and host/control-plane
fingerprints. `supportedOrigins` contains exact reviewed workspace image digests.
Empty origins require `manualRequired: true`. A legacy manifest is never accepted
as a native runtime release.

Generate the manifest from the committed checkout:

```bash
python3 deploy/updater/release.py --tag workspace-vVERSION \
  --image ghcr.io/alshival-ai/neural-labs-workspace@sha256:DIGEST
```

Automatic discovery verifies attestations for both image and manifest against
the trusted repository, release workflow, tag, and source commit. It rejects
self-hosted signers. Do not remove these checks to make an operator-built image
appear automatically eligible. An operator release and an attested automatic
release are distinct publication paths. Neither `make validate` nor a source
push publishes or activates an image.

The reviewed `workspace-v*` release workflow builds workspace and control-plane
images natively on Linux amd64 and ARM64 runners. Each workspace candidate must
initialize its pinned Codex app-server and Claude Code structured stream using
disposable empty account homes, without inference or tenant credentials. The
workflow merges only the two tested image digests, checks the published platform
indexes, rehearses the updater against generated state, and attaches the native
manifest and control-plane image digest to the GitHub release. The protected
`workspace-releases` environment requires a configured maintainer reviewer.
Creating a release tag is a separate publication step after the remaining
product and operator gates pass.

The baseline policy must stay operator-only until the actual native migration,
provider protocols, and restoration checks pass on both architectures. Required
release evidence includes preservation results, digests, and measured performance;
container health alone is insufficient.

## Recovery and retention

The host worker journals intent before mutation and uses unique cloned home
volumes. It gates ingress and scheduling, checks activity twice, and starts the
candidate in probation with execution and delivery disabled. The readiness probe
checks native image pins, actual Codex and Claude initialization with disposable
empty homes, runtime health, and isolation without inference or credential access.

Before the durable commit decision, a failure restores the prior immutable image
and original volume. After that decision, recovery retains the selected candidate
state. Once activation may have accepted writes, an interruption requires forward
recovery; never restore an older database or volume over new writes. PostgreSQL
recovery copies are never automatically restored by the worker.

Keep gates closed when recovery cannot be verified. Inspect `journal.json`,
`active-compose.yaml`, `base-compose.json`, and `backups/<job-id>/deployment.json`
before selecting a recovery path. Capacity checks include retained copies and
reserve space. There is no automatic pruning. Local recovery copies are not NAS
backup or restore verification.

## Validation

`make validate` covers contracts, authentication, maintenance state transitions,
manifest identity, DST windows, and UI. PostgreSQL integration tests require an
isolated `TEST_DATABASE_URL`; never point them at production.

`tests/updater_rehearsal.py --image IMMUTABLE_IMAGE` explicitly exercises the real
Docker clone/restore adapter using generated state and a synthetic service.
`tests/native-container-smoke.mjs` separately checks real provider protocols,
private editors, skills, and Chromium inside the candidate. These are distinct
checks: synthetic adapter success does not establish native migration readiness.
The container smoke check also invokes the packaged, operator-only file-history
entrypoint against generated files, verifying native workspace-root configuration,
idempotent import, and preservation of newer working copies.
