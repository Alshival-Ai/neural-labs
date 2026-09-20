# Workspace updates

Administrators configure OpenClaw and terminal Codex in **Settings → Updates**.
OpenClaw follows reviewed Neural Labs workspace releases. Codex checks the stable
official npm release daily and selects a verified installation for new launches.
Disabling Codex updates keeps the installed version. Its OpenClaw app-server is
separately pinned in the reviewed image and never follows terminal updates.

OpenClaw defaults to manual installation. Its suggested automatic window is
Sunday 03:00–05:00 America/Chicago. An open terminal or editor, an active chat,
job, upload or notification defers deployment. “Install now when idle” skips the
window, but still waits for idle. Settings show worker connectivity, installed
and available versions, deferrals, errors, and update history. Members see a
maintenance notice; the control plane remains available during workspace restart.

## Explicit operator bootstrap

Requirements: Linux with systemd, Python 3.11+, Node/Docker Compose supporting
`!override`, GitHub CLI supporting artifact attestations, and root Docker access.
This first host adapter uses the standard project layout and ports 4174,
4180/4181 (front), and 4182/4183 (back). It supports one linux/amd64 workspace
with the three documented persistent volumes and the reviewed SMS ingress.
Polling channel configurations require operator maintenance. Custom ports, mounts, or topology
require an adapter review before installation.

1. Run `make validate` and build the new workspace/control-plane images. Execute
   the synthetic deployment and rollback rehearsal below before activation.
2. From the repository, run the explicit preparation command:

   ```bash
   sudo python3 deploy/updater/install.py prepare --repository "$PWD" --confirm
   ```

   This generates a dedicated updater token in the private `.env`, captures a
   protected Compose snapshot, and installs disabled root-owned service files.
   It does not restart the workspace. The root-owned configuration is
   `/etc/neural-labs/updater.json`; deployment descriptors, journals, archives,
   and retained releases live in `/var/lib/neural-labs/updater`, or
   `/var/snap/docker/common/neural-labs-updater` for Snap Docker. Preparation
   detects this automatically; `stateDirectory` records the selected path.
3. Rebuild/deploy the control plane and workspace through the normal operator
   deployment process so the token and update protocol are running. Configure
   the worker's GitHub credentials under `/etc/neural-labs/gh` and registry
   credentials in the selected state directory's `docker/` subdirectory if the packages are private.
   Never copy these into the workspace. The protected configuration's
   `budgetSeconds` defaults to one hour and `reserveBytes` to 10 GiB; adjust
   only after measuring the backup, clone, readiness and restore rehearsal.
4. Close all terminal/editor sessions and wait for active work to finish, then:

   ```bash
   sudo python3 /opt/neural-labs-updater/install.py activate --confirm
   ```

   Activation checks control-plane compatibility and workspace activity, pauses
   work, moves backend listeners, starts the host proxy, verifies readiness,
   and enables the two services. It is a workspace restart. Failure leaves
   protected bootstrap state for an operator; do not remove gates blindly.
5. Verify “Host updater: Connected” in Settings. Publish a reviewed release and
   use “Check now”. Leave automatic OpenClaw installation off until the first
   installation and recovery exercise has been reviewed.

The legacy deployment CLI refuses mutations once the managed host descriptor is
active. Status/log inspection requires root access to the descriptor. For a
manual host/control-plane upgrade, stop the updater worker, close ingress and
control-plane gates, take a backup, and explicitly reconcile the protected base
Compose snapshot and compatibility fingerprints. Do not run a second Compose
project against the retained original volumes.

## Publishing a reviewed release

Configure required maintainers for the GitHub environment `workspace-releases`
and protect the `workspace-v*` tags. Review
[`workspace/openclaw-release.json`](../workspace/openclaw-release.json) and
[`workspace/update-release-policy.json`](../workspace/update-release-policy.json).
The latter lists the exact baseline images whose migration and restoration must
pass. Never claim an unsupported origin. The workflow refuses to publish if the
environment has no required-reviewer rule.

Push an approved `workspace-v...` tag to run the
[release workflow](../.github/workflows/workspace-release.yml). It validates the
repository, builds the image, rehearses migrations and restore for every listed
origin, compares the candidate's `/app` against its exact upstream image, and
runs the isolated deployment/rollback rehearsal. After those pass, it publishes
an immutable image and attested `workspace-release.json`. The manifest records
upstream/source revisions, client/protocol/SMS versions, terminal/app-server
versions, compatibility fingerprints, architecture and supported migration
origins. Both attestations must match the trusted repository, workflow, tag and
commit. See [GitHub CLI's verification contract](https://cli.github.com/manual/gh_attestation_verify).

A new upstream OpenClaw release alone does not authorize an automatic update.
Releases that require different host/control-plane code or a different migration
baseline display “Manual upgrade required”. Registry publication, GitHub
reviewer configuration and service activation are operator operations, not
side effects of `make validate`.

## Recovery and retention

The worker holds a host lock, journals intent before deployment operations, and
reports phases to PostgreSQL. It replays interrupted reports and reconciles
interrupted deployments. During probation, candidate changes stay on clones.
An unsuccessful candidate restores the previous immutable image and the three
original volumes. The database archive is retained for disaster recovery and is
**never** restored by the automatic worker.

After the durable commit decision, the worker may restart the candidate before
activation but never restore the old state automatically. Heartbeats and cron
remain paused through this restart. Once activation admits new work, an
interruption keeps the selected volumes and requires operator recovery; it does
not restart a workspace that may have accepted new writes. A `recovery_required` result keeps
both gates closed. Stop `neural-labs-updater.service` before operator recovery;
inspect the protected `journal.json`, `active-compose.yaml`, `base-compose.json`,
`bootstrap-deployment.json` and the matching `backups/<job-id>/deployment.json`.
Do not switch volumes until you have established whether `committed` is true.
Verify the chosen deployment and paused-scheduler ledger before reopening access.
After recovery, use an explicit audited database operation to clear the gate;
there is intentionally no browser “force reopen” button.

Backups, original volumes and terminal Codex versions are retained. Capacity
checks include archive/clone headroom and a reserve; insufficient space blocks
deployment. Review retention manually. No automatic pruning is implemented.

## Validation and isolated rehearsal

`make validate` runs policy/authentication, UI, activity/quiet-mode, state-machine,
manifest and DST tests without starting containers or changing the host.
PostgreSQL integration tests run when `TEST_DATABASE_URL` points to an isolated
test database. They test revision races, concurrent requests, terminal report
replay, held releases and the irreversible commit boundary.

The following explicit test creates only uniquely named synthetic containers
and volumes, tests the real Docker adapter's archives/clones and rollback, and
cleans up that synthetic state:

```bash
sudo python3 tests/updater_rehearsal.py --image sha256:REPLACE_WITH_BUILT_IMAGE_ID
```

For snap Docker, set `UPDATER_REHEARSAL_ROOT` to a non-hidden directory Docker can
mount. The separate `bin/openclaw-upgrade-smoke BASE_DIGEST CANDIDATE_DIGEST`
checks native migrations, credentials/ownership, transcripts, roles, and SMS
with synthetic state. The release workflow also runs a local fake-model chat,
checks global scheduler pause/resume and per-agent heartbeat suppression, and
exercises the pinned Codex app-server’s public initialization/thread-list protocol
in an empty account directory. Neither test mounts production volumes. The Docker
adapter rehearsal uses a synthetic service to inject deterministic failures;
it complements, rather than replaces, the native OpenClaw smoke suite.
