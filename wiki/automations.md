# Automations desktop app

Automations is the Neural Labs desktop client for OpenClaw's built-in scheduler.
It reads and writes the same durable jobs and run history as the
`openclaw automations` CLI. There is no second Neural Labs scheduler or database.

The dock launcher is visible only to Neural Labs administrators. The app can:

- show scheduler connectivity, enabled/running/error counts, and live job state;
- search and filter jobs;
- create and edit one-time, interval, cron, process-exit, and stream schedules;
- create system-event, agent-turn, command, and script payloads;
- pause or enable jobs and force a run, run only when due, or run only when enabled;
- inspect durable execution and delivery history; and
- remove non-system jobs.

OpenClaw remains authoritative for schema validation, permissions, execution,
delivery, auto-disable behavior, and tool-policy ceilings. Command and script
payloads, condition scripts, and stream commands are unattended code execution;
the warning in the form is explanatory and is not the security boundary.

## Administrator connection

The ordinary Neura WebSocket deliberately cannot administer the scheduler.
Automations uses `/workspace/automations/socket`, which is also the shared
administrator connection for the Skills desktop app. Nginx gates it with the
control plane's active-administrator check before asserting a fixed trusted
proxy identity. OpenClaw grants that identity connection-only
`operator.read,operator.admin` scopes. The client does not create an OpenClaw
browser device or store a reusable OpenClaw token, so the admin grant exists
only on that trusted-proxy-authenticated WebSocket. OpenClaw's configured role
keeps admin in its ceiling but does not grant it to ordinary Neura connections,
which remain capped below admin. The connection is recycled every five minutes
so account demotion or disablement is rechecked.

The deployment CLI builds and starts containers but intentionally does not
install host Nginx configuration. After changing
`deploy/nginx/neural-labs.ai.conf`, an operator must install it into the host's
active site configuration, run `nginx -t`, and reload Nginx. See
[ADR 0005](adr/0005-admin-gated-automations-ingress.md) for the trust-boundary
decision.

The route name is historical. Its security contract is an active Neural Labs
administrator check plus a fixed OpenClaw service identity, not access to one
specific desktop app.

## Form conventions

- Interval values use durations such as `30m`, `4h`, or `1d`.
- Stream commands must be a JSON argv array such as
  `["node","scripts/events.mjs"]`.
- Command payloads accept either a JSON argv array or shell text. Shell text is
  run through `/bin/sh -lc` in the shared workspace container.
- One-time values use an ISO local date/time and the selected IANA timezone, or
  an ISO timestamp with an explicit offset.
- `Workspace default` leaves model selection to the configured OpenClaw agent.
- Job updates use OpenClaw's configuration revision when available, preventing
  a stale desktop window from silently overwriting a newer edit.

OpenClaw events trigger a prompt refresh across open Automations windows, with
a 30-second reconciliation poll as a fallback.
