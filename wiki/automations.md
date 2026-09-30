# Run and manage automations

Automations runs repeatable work through the Neural Labs native scheduler and Codex or Claude Code. Open it from the
dock shortcut or **Skills → Automations**. The workspace must stay running for
scheduled jobs to execute; your browser can be closed.

## Run an existing AI task

1. Connect your AI account in **Settings → Model Provider**.
2. Open Automations and select a job.
3. Review its schedule and current state, then use its Run action if available.
4. Watch the job's status and run history for completion or failure.

All active members can see operational job state and manually run eligible AI
tasks. A manual run uses the account of the person pressing Run. Missing,
paused, or unavailable personal connections block submission. It does not
change the original job's schedule or assigned account.

Scheduled runs use the job’s saved connection and model, with background access
checked at execution time. New jobs save the administrator’s selected connection
and model. Editing preserves that binding; there is no personal-account fallback. See [AI accounts and models](ai-accounts.md).

System-event, system-owned, command, and script jobs do not gain personal AI
execution through this action. A job with an incompatible execution policy is
also rejected. If a submission's outcome is uncertain, inspect its state before
retrying; the adapter blocks another manual run while acceptance is unresolved.
New jobs forbid overlapping executions by default. Workflow locks also coordinate
jobs configured to modify the same resources. Unknown outcomes retain their locks.

## Create or change a schedule

Administrators can create, publish, edit, pause, enable, duplicate, and delete
automations. Members' ability to run an existing AI task does not grant these
scheduler-management permissions.

1. In Skills, choose **+ Automation**.
2. Name the job and choose its trigger: one-time, interval, cron, supervised process exit, or supervised line stream.
3. Configure the action. **Run a skill** starts an AI task with `$skill-name`
   and an optional prompt. Select your AI connection and model in Model Provider before creating the job.
   That connection must be authorized for background execution.
4. Review and validate the draft, then publish it. Check the saved job's enabled
   state and schedule before relying on unattended execution.

Draft edits autosave but do not change a live job until publication. See
[Skills](skills.md) for the collaborative builder.

Useful form conventions:

- Intervals accept durations such as `30m`, `4h`, and `1d`.
- Choose the intended timezone for a one-time or cron schedule. ISO timestamps
  with explicit offsets can also identify one-time runs.
- Actions are agent instructions or a skill invocation.
- Each run gets its own session. Results remain in run history.
- Use **Subscribe** for result/failure notifications. Optional consecutive-failure
  thresholds and cooldowns govern external failure alerts. Every finalized outcome
  still has a run receipt, and in-app subscriber notifications remain available.
- Maximum schedule delay adds a deterministic delay from zero to the configured
  milliseconds (at most one day). Accepted delayed occurrences survive restarts.
- Light context starts with a fresh account home and only explicitly requested
  skills. Workspace files and required workspace instructions remain accessible;
  previous CLI conversation history is excluded.
- Existing drafts retain unsupported values and show a validation error before
  publication. Imported jobs with these policies remain held for review.

Agent instructions can execute workspace commands under the saved execution
policy. Review the job’s access and outputs before enabling unattended work.
The native runtime validates policy again on create, edit, review, and admission.

## Failure alerts and trusted event sources

Failure alerts are optional. With a policy configured, only scheduled failures
advance its durable streak. Scheduled success resets the streak and cooldown;
manual runs, cancellation, admission blocks, and uncertain outcomes do not advance
it. Admission blocks remain visible as holds. After reaching the threshold,
external failure notifications respect the cooldown (default one hour). Existing
subscriptions and consent still apply; enabling a policy creates no subscribers.

Process and stream sources run administrator-saved command argv inside the
workspace sandbox, without provider credentials or host access. Use an absolute
executable and a workspace-relative working directory, for example
`["/bin/sh", "scripts/watch.sh"]` with directory `.`. Each stream stdout line is
an event; a process source emits one event when it exits with a known exit code.
Source output is passed to the agent as untrusted data, never as an instruction.

Sources are bound to the saved member/account, definition, and generation. Events
are persisted and deduplicated. Pending queues are limited to 100 events and 1 MiB
per job; a line/buffer is limited to 64 KiB. Overflow holds the job for review.
Maintenance and revoked access stop supervised children. Streams restart with a
new generation no sooner than five seconds after the previous start. Interrupted
process sources require review; no exit event is invented. Change or duplicate a
finished process definition to run its source again. Run now executes the AI task;
it does not fabricate an event or launch the source command.

## Supported release boundaries

| Capability | Status |
| --- | --- |
| Cron, interval, one-time, supervised process/stream | Supported |
| Failure thresholds/cooldowns, schedule delay, light context | Supported |
| Gmail/Outlook/Twilio member notifications | Supported; account setup required |
| Generic SMTP, direct arbitrary webhook delivery | Unsupported |
| Shared sessions, legacy conditions/pacing, stream match scripts | Retired legacy modes |
| Provider fallback and custom tool allowlists | Unsupported; saved execution policy applies |

Imported jobs keep their original definitions and holds. Support for a field does
not automatically enable an imported job. Unsupported configurations require an
explicit replacement/review; the runtime does not discard their fields.

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
Alshival, SMS, or email delivery. **Settings → Personalization** controls channel
permission and defaults. Each subscription can choose different channels. No
member is subscribed automatically; unsubscribing or disabling a channel
suppresses pending delivery.

Alshival updates appear through **Automations** in private chat history and persist
while you are offline. Opening the entry creates a private follow-up
conversation if needed. Receiving an update does not execute an agent turn;
replying starts a turn with the visible results as context.

SMS needs a verified phone, administrator-configured Twilio, and your SMS opt-in.
Email uses the workspace Gmail or Outlook connector. Verify your address and
opt into email in Settings → Plugins, then enable email notifications.
SMS also requires the connector opt-in. The former Microsoft application-mail
sender is retired: saved settings are retained, but are not a fallback transport.
See [Settings](desktop-settings.md) for configuration. Provider acceptance does
not establish confirmed delivery.

Results wait for the scheduler's final outcome. When a run cannot provide a
summary, a concise outcome notice can still be sent. Raw execution logs are
not copied into notifications, and agents cannot select arbitrary recipient
phone numbers or email addresses.

## Operator and maintainer reference

Neural Labs owns the durable SQLite scheduler and run history. Notification
subscriptions and the outbox live in PostgreSQL. Back up both using
[Backup and restore](backup-restore.md).

Member listing and administrator mutations use authenticated HTTP routes.
Administrator roles, revision checks, member authority and connection generation
are enforced by the native runtime. The former automations WebSocket is retired.

Design history: [administrator ingress](adr/0005-admin-gated-automations-ingress.md),
[notifications](adr/0030-automation-notification-subscriptions.md), and
[personal manual runs](adr/0033-personal-manual-automation-runs.md).
The optional [site-generation workflow history](reference/site-generation-history.md)
is maintained separately from these everyday instructions.
