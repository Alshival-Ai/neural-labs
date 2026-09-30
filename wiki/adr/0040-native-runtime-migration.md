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

The native workspace image must not contribute team-specific skills to every
tenant. Skill discovery uses the workspace's own team and personal directories
plus packages installed into that workspace. Claude's native tool list is
explicitly limited to file discovery and reads for read-only policy, with Edit,
Write and Bash added for workspace-write policy. Bash uses the same selected
account and workspace Bubblewrap filesystem view as the provider process;
permission requests go through the active user's approval flow. Network-fetch
tools are not granted to Claude turns. Provider processes still need outbound
access for AI inference, so host egress rules and the process filesystem
namespace remain separate containment controls. The selected account home is
visible to its own provider and subprocesses; this boundary does not establish
workspace-files-only access.

SQLite records occurrence claims before execution. Lost responses and interrupted
claims are unknown and never automatically replayed. Unknown work retains its
workflow lock. Manual executions retain their initiating actor/connection without
modifying the scheduled account. Scheduled permission requirements block work
visibly rather than widening permissions.

Team Chat uses a separately saved Team connection and model. Each native Team
turn is bound to the control plane's running channel capability, initiating
member, active channel membership, credential generation, and (for managed
instances) live portal membership. The runtime revalidates that binding while
the CLI runs. A local MCP proxy holds the channel capability server-side and
exposes only the invoking channel's tools to the provider. Native command/file
permission requests require an active administrator's explicit decision;
managed administrator role is checked against the portal at decision time.
The initiator's personal connection is never a Team fallback. Team turns mount
only workspace-owned Team skill packages; only the current triggering message
can explicitly activate one, so old transcript mentions cannot replay skills.

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

The candidate entry point and images now use the native service and isolated
provider launchers. Browser requests carry short-lived signed control-plane
assertions; lease renewal checks active membership and credential generation.
Native calendar and interval scheduling, installed package projection, retained
history, and explicit activation comparisons are implemented and tested.

The first managed migration clones PostgreSQL as well as filesystem state before
any chat reset. Original update preferences stay readable by the retained control
plane; native preferences use a separate table. A scoped operator journal permits
schema migration while preserving the closed admission gate. See
[Native runtime migration](../native-migration.md) for staged operator steps.

Imported automation holds can now be released through an administrator review.
The runtime checks the exact source revision, active membership/administrator role,
selected credential generation, native sign-in, and separate background authority
before committing the new binding. SQLite atomically records the before/after
definitions and review request ID, preserving completed flags and occurrence
claims. Unknown work and unsupported policies remain held. This review cannot
grant a browser background execution authority or change its personal selection.

Existing installations remain pinned unless explicitly upgraded through the
operator preview procedure. Complete application integrations, public release
publication and pilot acceptance are unfinished. Protocol initialization
and recovery rehearsal on native ARM64 do not establish real model inference or
the representative four-job workload on an 8GB Pi. No native runtime image is
approved for automatic migration by this ADR.
