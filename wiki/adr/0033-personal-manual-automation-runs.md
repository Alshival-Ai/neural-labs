# ADR 0033: Personal accounts for manual automation runs

- Status: Accepted
- Date: 2026-09-10
- Extends ADR 0032 and the existing admin-only Automations ingress

Run Now for AI task automations resolves the signed-in developer's personal
ChatGPT agent on the server. Missing, paused or unavailable personal connections
block submission. The browser cannot provide an account override. Scheduled runs
retain the automation's configured agent; manual execution never temporarily
reassigns the original job or copies credentials.

The official 2026.9.2 `cron.run` protocol has no per-run agent override. Neural
Labs therefore creates a disabled, isolated execution job using public scheduler
APIs and a durable link to its parent. It retains the payload's explicit model,
reasoning, timeout and tool allowlist, with no model fallbacks. Implicit model
selection uses the caller's personal defaults. The native scheduler assigns the
admin-created execution's tool policy; a source with a non-trusted policy is
rejected because that policy cannot be copied through the public protocol.
System-event, system-owned, command and script jobs do not acquire personal AI
execution semantics through this path.

The same-origin HTTP routes require an authenticated admin identity supplied by
the existing proxy. The shared Automations WebSocket remains for administrative
editing and event refresh; ordinary Run Now buttons use the personal route.
This is not a restriction on administrators independently invoking the raw
Gateway CLI or API. No new grants are added for non-administrators.

An atomic registry under the workspace runtime's private Files state records
parent, execution, caller and request identities. Creation is recorded before
submission. Retries with the same identity cannot submit twice, and uncertain
acceptance remains visible and blocks another manual run until inspected. One
workspace server owns this registry. Separate server replicas would require a
shared transactional lock before adoption. Execution jobs remain disabled and
are retained for history; they never fire on their placeholder schedule.

Manual history and current state are projected under the parent automation in
the UI, including the initiating account. The notification bridge resolves the
execution's context and run identity to the parent's subscriber list. The
control plane trusts only that authenticated bridge's canonical job identity.
Scheduled and manual executions have separate native sessions; workflow locks
are still needed for tasks that must exclude overlap with a scheduled run.

No upstream files, scheduled jobs, existing subscriptions or account credentials
are rewritten. Deploy the workspace adapter, control-plane canonicalization and
desktop together. Verification uses mocked account/scheduler services and the
installed public protocol validators without executing real automation tasks.

## Amendment: workspace member manual runs (2026-09-12)

Active workspace members may now list operational automation state and submit
manual AI task runs through the same-origin HTTP adapter. The proxy supplies the
member identity and role; request bodies cannot select another account. The
adapter retains personal connection checks, source execution-policy checks,
no-fallback routing, concurrency protection and durable execution identities.
Members receive job names, schedules, state and run timing/status only, without
administrative payloads, delivery settings, result text or session identifiers.

This extends the previous administrator-only submission boundary. Scheduler
management, shared skill installation and the privileged Automations WebSocket
remain administrator-only. The desktop uses HTTP for member listing and runs;
no additional Gateway scopes or host proxy changes are needed. Scheduled runs
continue to use their configured account.
