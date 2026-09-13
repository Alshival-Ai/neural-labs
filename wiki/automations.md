# Run and manage automations

Automations runs repeatable work through OpenClaw's scheduler. Open it from the
dock shortcut or **Skills → Automations**. The workspace must stay running for
scheduled jobs to execute; your browser can be closed.

## Run an existing AI task

1. Connect your personal ChatGPT account in **Settings → Model Provider**.
2. Open Automations and select a job.
3. Review its schedule and current state, then use its Run action if available.
4. Watch the job's status and run history for completion or failure.

All active members can see operational job state and manually run eligible AI
tasks. A manual run uses the account of the person pressing Run. Missing,
paused, or unavailable personal connections block submission. It does not
change the original job's schedule or assigned account.

Scheduled runs use the job's configured agent. Jobs assigned to `main` need the
administrator's background ChatGPT connection. The shared audio API key does
not fund text tasks. See [AI accounts and models](ai-accounts.md).

System-event, system-owned, command, and script jobs do not gain personal AI
execution through this action. A job with an incompatible execution policy is
also rejected. If a submission's outcome is uncertain, inspect its state before
retrying; the adapter blocks another manual run while acceptance is unresolved.
A scheduled run and a manual run can overlap, so workflows that modify the same
resources need their own coordination.

## Create or change a schedule

Administrators can create, publish, edit, pause, enable, duplicate, and delete
automations. Members' ability to run an existing AI task does not grant these
scheduler-management permissions.

1. In Skills, choose **+ Automation**.
2. Name the job and choose its trigger: one-time, interval, cron, process-exit,
   or stream.
3. Configure the action. **Run a skill** starts an AI task with `$skill-name`
   and an optional prompt. Select the assigned agent and any model settings
   deliberately; those determine scheduled execution.
4. Review and validate the draft, then publish it. Check the saved job's enabled
   state and schedule before relying on unattended execution.

Draft edits autosave but do not change a live job until publication. See
[Skills](skills.md) for the collaborative builder.

Useful form conventions:

- Intervals accept durations such as `30m`, `4h`, and `1d`.
- Choose the intended timezone for a one-time or cron schedule. ISO timestamps
  with explicit offsets can also identify one-time runs.
- Stream commands use JSON argv arrays, such as `["node","scripts/events.mjs"]`.
- Command payloads accept argv arrays or shell text; shell text executes through
  `/bin/sh -lc` inside the workspace.
- `Workspace default` leaves model selection to the assigned OpenClaw agent.

Commands, scripts, conditions, and streams execute unattended code. Review the
job's access and outputs before enabling it. OpenClaw validates the saved
schema and execution policy.

## Status, history, and item actions

Members see names, schedules, enabled/running state, and summarized outcomes.
Administrators can also inspect payloads, execution details, errors, delivery
settings, and usage. The API omits those details from member responses; this
does not create filesystem isolation inside the shared container.

Right-click a job or use its **…** menu. Keyboard users can use Shift+F10.
A duplicate is paused and receives a new name; it does not copy subscribers or
run history. Delete requires confirmation, and running or system-managed jobs
cannot be deleted here. Deleting an automation does not remove previously
published skills, generated files, or public sites.

Manual execution history is shown under the parent automation with its
initiating account. Scheduled and manual executions have separate native
sessions. Do not interpret a successful manual run as proof that the scheduled
account has working credentials.

## Subscriptions

Open an automation and choose **Subscribe** to select results, failures, and
Neura, SMS, or email delivery. **Settings → Personalization** controls channel
permission and defaults. Each subscription can choose different channels. No
member is subscribed automatically; unsubscribing or disabling a channel
suppresses pending delivery.

Neura updates appear through **Automations** in private chat history and persist
while you are offline. Opening the entry creates a private follow-up
conversation if needed. Receiving an update does not execute an agent turn;
replying starts a turn with the visible results as context.

SMS needs a verified phone, administrator-configured Twilio, and your SMS opt-in.
Email needs your explicit opt-in and an administrator-configured Microsoft 365
sender, including mailbox ID/address and application Mail.Send permission.
See [Settings](desktop-settings.md) for configuration. Provider acceptance does
not establish confirmed delivery.

Results wait for the scheduler's final outcome. When a run cannot provide a
summary, a concise outcome notice can still be sent. Raw execution logs are
not copied into notifications, and agents cannot select arbitrary recipient
phone numbers or email addresses.

## Operator and maintainer reference

OpenClaw owns the durable scheduler and native run history. Neural Labs adds
notification subscriptions/outbox state in PostgreSQL and manual-execution
tracking in the persistent workspace. Back up both using
[Backup and restore](backup-restore.md).

Member listing and manual runs use authenticated same-origin HTTP routes.
Administrator scheduler controls use `/workspace/automations/socket`, which
Nginx gates with the control plane's active-administrator check. The ordinary
Neura socket does not grant scheduler administration. Apply changed Nginx
routes through the explicit [ingress steps](container-deployment.md#enable-https-ingress).

Design history: [administrator ingress](adr/0005-admin-gated-automations-ingress.md),
[notifications](adr/0030-automation-notification-subscriptions.md), and
[personal manual runs](adr/0033-personal-manual-automation-runs.md).
The optional [site-generation workflow history](reference/site-generation-history.md)
is maintained separately from these everyday instructions.
