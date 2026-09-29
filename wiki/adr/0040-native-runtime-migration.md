# ADR 0040: Native provider execution and preservation before cutover

Status: architecture accepted; implementation and rollout in progress.

## Decision

Neural Labs will replace OpenClaw execution and scheduling with container-local
Codex app-server and Claude Code processes mediated by a Neural Labs runtime.
The browser must never connect directly to a provider process. The existing
control plane remains responsible for identity, membership, private connector
credentials and notifications. Optional managed-host integration remains generic;
portal billing and hosting policy stay outside this repository.

Persist actor, credential owner, provider, billing method, generation and native
session bindings before launching a turn. Keep per-conversation serialization
and explicit workflow locks; independent conversations and jobs have no global
concurrency cap. Release idle provider processes while retaining native sessions.
Use the same owner-selected native credential home for private terminal login
and execution. Never substitute a provider or API billing method implicitly.

Native file and shell tools introduce a filesystem boundary that did not exist
in the Gateway-only tool adapter. The execution broker must isolate other owners'
credential homes from the selected process, including subprocesses. Supplying
only a filtered environment does not satisfy this boundary. The runtime requires
broker-supplied spawn/version-probe functions plus a live execution revalidator.
Membership, generation, account state and background authorization must be
checked at admission, before spawn, during execution and after approval.

SQLite records occurrence claims before execution. Lost responses and interrupted
claims are unknown and never automatically replayed. Unknown work retains its
workflow lock. Manual executions retain their initiating actor/connection without
modifying the scheduled account. Scheduled permission requirements block work
visibly rather than widening permissions.

## Preservation

Use a read-only inventory, then a consistent export after gating and draining
the same workspace. Preserve packages, hidden ownership metadata, assets,
collaborative state, proposals and proposal events/rollbacks, all scheduler
definitions and available history, checkpoints, subscriptions and delivery state.
Retain system/manual-helper/unsupported records explicitly. Keep source schemas
and raw records alongside native projections. Compare hashes and counts, and
hold imported jobs for reviewed account/policy bindings without changing enabled
flags. Imported one-time completion and uncertain-run state must survive restart.

Record each workspace's chat-reset policy explicitly. A team-pilot reset does
not authorize resets for customer workspaces. The preservation importer itself
does not delete conversations, restore PostgreSQL, enable scheduling or send
historical notifications. The control plane stays authoritative for notification
and connection state; archive snapshots are evidence, not replay queues.

Before admitting new writes, retain the original release and same-workspace
state for recovery. After activation, keep new writes and recover forward. Local
retained copies do not establish NAS backup or hardware acceptance.

## Current implementation boundary

The preparatory modules under `workspace/native/` provide preservation, native
state/claims, schedule rendering, provider protocols and a gated turn coordinator.
They are not the deployed entry point. Existing images and installations remain
on their current runtime until API/UI, login, filesystem isolation, MCP tools,
notification transports, native scheduler, image publication and managed cutover
pass their release checks. The current OpenClaw manifest and ADR 0036 updater
contract remain authoritative for existing installations.

Provider initialization probes use the reviewed 0.155.1 Codex and 2.1.226 Claude
executables with empty account homes and no network. Mocked streams verify
permission/revocation behavior; they do not establish live model compatibility
or performance. Native amd64/ARM64 publication, calendar/DST behavior under pinned
Supercronic and the complete four-job workload on an 8 GB ARM64 Pi remain release
acceptance gates. No native runtime image is approved by this ADR.
