# Automations app design handoff

`AutomationsApp.tsx` retains the self-contained responsive presentation for the
shared OpenClaw scheduler. `AutomationsLiveApp.tsx` now supplies live state and
mutations through `automationsGateway.ts`, and `App.tsx` mounts it in an
administrator-only desktop window.

The design was checked against the installed `@openclaw/gateway-protocol` `2026.8.2` schema and the current [OpenClaw automations documentation](https://docs.openclaw.ai/automation/cron-jobs).

## OpenClaw parity represented

- Schedule kinds: `at`, `every`, `cron`, `on-exit`, and `stream`, including timezone, exact timing, pacing, and condition-trigger affordances.
- Payload kinds: `systemEvent`, `agentTurn`, `command`, and `script`; read-only system-owned jobs can also display `heartbeat` and `skillCollectionReview` payloads.
- Execution: main, isolated, current, and custom session targets; agent, model, thinking, tool-policy, wake-mode, and timeout fields.
- Delivery: announce, webhook, and none, with separate execution and delivery states.
- Operations: compact job list, full job details, enable/disable, update, force run, run-if-due, run-if-enabled, durable run history, error details, failure streaks, and auto-disabled state.
- Scheduler health: the UI explicitly shows that schedules depend on the Gateway being online.

## Implemented integration

1. `cron.status`, `cron.list`, and `cron.runs` load one coherent snapshot for
   scheduler health, jobs, and durable history.
2. Create and edit submissions map to `cron.add` and `cron.update`; updates send
   `expectedConfigRevision` when OpenClaw supplies it.
3. Enable/pause uses `cron.update`, manual run controls use the exact `force`,
   `due`, and `if-enabled` protocol values, and removal uses `cron.remove`.
4. OpenClaw cron events prompt a debounced refresh, with periodic reconciliation
   as a fallback.
5. The dedicated Automations WebSocket requires a live Neural Labs administrator
   session and receives a connection-only OpenClaw admin identity grant. See
   `wiki/adr/0005-admin-gated-automations-ingress.md`.
6. Server authorization remains authoritative. Command/script payloads,
   condition scripts, and stream sources are operator-admin or unattended-code
   surfaces; the UI warning is not a security boundary.

The component owns its scoped stylesheet through
`import "./automations-app.css"`. The exported placeholder records remain only
as deterministic design/test fixtures and are never passed by the live app.

## Responsive behavior

The desktop view keeps the job rail and selected job visible together. On tablet and mobile, selecting a job opens a full-height detail layer with a back control. Metrics scroll horizontally, route diagrams stack, run rows simplify, and the create/edit drawer becomes full width.
