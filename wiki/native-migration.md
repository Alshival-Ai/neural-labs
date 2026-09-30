# Native runtime migration

Status: native preview; full replacement acceptance remains in progress. Operators
may deploy the preview for desktop, files, Terminal, personal native AI, skills,
and basic time-based agent automations after instance-specific preservation checks.
Team Neura execution, additional automation policy adapters, browser MCP and new
notification transports remain incomplete. Existing installations stay pinned
unless their operator explicitly selects this preview and accepts its scope.

The candidate runs Codex app-server and Claude Code behind the authenticated
Neural Labs runtime. It has no OpenClaw executable, Gateway listener or runtime
package dependency. Legacy names in retained data identify migration inputs;
they do not start the old runtime.

## Preserve before activation

Use the existing installation's managed host workflow. Close ingress and execution
admission, pause the old scheduler, drain active work, and stop its writers before
making the final export. A read-only inventory taken while work continues is not
a cutover snapshot. Keep credentials and recovery copies private and bound to the
same workspace.

The website managed upgrader stages the native transition in separate phases:

1. `apply` gates and drains, retains original filesystem directories, takes a
   PostgreSQL dump, and creates a distinct database for the same workspace.
   The candidate descriptor names `neural_labs_native_` followed by the first
   twenty characters of its exact source commit. It stops at `prepared`.
2. Export and import the drained filesystem packages and database records with
   `bin/native-migration.mjs`. Every collection is explicit, including empty
   collections. Scheduler IDs and full available receipt history survive.
3. `project` installs packages through an explicit JSON path map and checks
   original hashes, metadata, executable bits and directory permissions. It
   refuses conflicting files and symlinks. `verify` repeats the comparison
   against the installed paths and retained database records.
4. `start` starts the candidate in probation, with ingress, scheduling and
   external delivery gated. Its control plane uses the candidate database.
5. The operator calls `prepareNativeChatReset` only against that database, with
   the exported notification records and this workspace's explicit reset policy.
   The transaction refuses active work or changed notification state, detaches
   obsolete notification conversation references, and records a reset receipt.
   Subscriptions, notification events, delivery outcomes and deduplication records
   remain intact. Use `preserve` for customer deployments without reset consent:
   that policy deletes no Team Chat and detaches no notification references.
   Legacy AI transcripts remain in the retained state; native conversations start
   separately. Customer reset policy never derives from pilot consent.
6. `activate` compares the installed packages, native job definitions, fresh
   control-plane snapshot and reset receipt. It marks preservation readiness;
   all imported job holds and disabled scheduling/delivery remain in place.
   Optional `--after-commit /private/policy.json` records explicit `scheduling`
   and `delivery` values (`enabled` or `disabled`) for the later host resume.
   Enabling scheduling this way permits new reviewed native jobs; imported jobs
   remain held. The option itself never opens admission or starts a job.
7. Managed `verify` checks probation, readiness and idle state. Only then can
   `commit` make the durable activation decision and reopen ingress.

The preservation CLI accepts these operations:

```bash
node bin/native-migration.mjs inventory --legacy-db /private/source.sqlite
node bin/native-migration.mjs export --config /private/export.json --destination /private/new-bundle
node bin/native-migration.mjs import --source /private/new-bundle --destination /private/archive --database /private/native.sqlite --workspace WORKSPACE_ID --sha256 MANIFEST_SHA256
node bin/native-migration.mjs project --source /private/new-bundle --path-map /private/paths.json --database /private/native.sqlite --workspace WORKSPACE_ID --sha256 MANIFEST_SHA256
node bin/native-migration.mjs verify --database /private/native.sqlite --workspace WORKSPACE_ID --sha256 MANIFEST_SHA256
node bin/native-migration.mjs activate --control-plane-snapshot /private/current-records.json --chat-receipt /private/reset-receipt.json --database /private/native.sqlite --workspace WORKSPACE_ID --sha256 MANIFEST_SHA256
```

These are operator primitives, not an unattended upgrade script. Keep the runtime
stopped while changing its SQLite database and installed package paths. Each path
map supplies `teamSkills`, `personalSkills`, `drafts`, `proposalPackages`,
`installedSkills` and `artifacts` as canonical, nonoverlapping absolute directory
roots. Empty categories still have explicit directories. Reuse existing skill and
draft locations where workflows depend on them. No original package is rewritten
to translate provider-specific instructions.

Before commit, recovery selects the original descriptor, database and directories.
Retain the candidate copy for inspection; do not overwrite the original database.
After commit or admission of new writes, preserve those writes and recover forward.
Local recovery copies do not establish NAS backup or restore acceptance.

## Accounts and jobs

Native account sign-in uses the OpenAI and Anthropic cards in Settings → Model
Provider. OpenAI opens device authorization in a browser tab and shows the code
in its card. On completion, the card loads available models and selects the
provider's default model for that member's chats. Anthropic sign-in uses a
private Terminal for the returned code; its card tracks sign-in and model status.
Additional account scopes remain under Advanced connections. An OpenClaw-only
connection needs native reconnection; no account or billing substitution occurs
automatically.

Claude text output is persisted as exact provider deltas. Lease checks occur on
control requests and at short intervals during text output; nearby deltas are
batched for browser delivery to reduce request overhead. A regular Terminal
sign-in has a separate home and does not create an AI connection. If an existing
connection was already signed in, choose **Use for my chats** in its card before
opening a private Alshival conversation.

Imported jobs retain enabled/paused intent, original definitions and historical
receipts. Missing native connections, unsupported policies and uncertain old runs
remain visible holds. Completed one-time jobs stay completed. Reviewing a hold
must not replay an uncertain occurrence or change the scheduled account when a
member performs a manual run.

Administrators can open an eligible job's **Review migration hold** action in
Automations. Review the saved instruction and schedule, choose a native connection
and model, and explicitly select workspace access, missed-run and overlap policies.
Releasing the hold checks native sign-in and separate background permission without
launching a provider turn. It assigns the scheduled owner to the reviewing
administrator and the selected connection; it does not change personal chat or
manual-run selections. Shared and background connections can be selected directly.

Review retains enabled/paused intent, completed one-time flags, workflow locks,
checkpoints, IDs and history. It journals both definitions and rejects stale edits
or conflicting retries. Unknown outcomes, system/helper records, unsupported
triggers and policies (including delivery or failure policies without native
adapters) remain held for operator review. No unsupported field is silently dropped
to make a job eligible. Choosing catch-up behavior applies only to unclaimed future
scheduler decisions; it never retries a previously claimed unknown occurrence.
The same policy validation runs on create, edit, and immediately before manual
or scheduled execution. A previously saved unsupported definition cannot bypass
review by using Run now; scheduled admission records a blocked receipt and hold
without starting a provider or changing the desired enabled state.

## Acceptance evidence

Protocol initialization, filesystem isolation, native editor lifecycle, sandboxed
Chromium and commit/rollback rehearsals have passed on the native 8GB ARM64 fixture.
The current amd64 candidate also passed generated-state filesystem checks for
other account homes, private skills, runtime state, symlink and `/proc` traversal,
plus Codex/Claude initialization, editor revocation and sandboxed Chromium.
These checks used no tenant credentials or inference. Providers still share
the container network; the filesystem results do not certify outbound isolation.
Those checks do not establish real mixed-provider inference capacity. The measured
fresh-stack idle working set was approximately 197 MiB; there is no equivalent
old-stack comparison. Two/four simultaneous provider workloads, live account
sign-in and observed scheduled execution remain separate acceptance checks.
