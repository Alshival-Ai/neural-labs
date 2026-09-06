# ADR 0023: Scoped model connections and versioned workload defaults

- Status: Accepted for OpenAI; Claude subscription adapter remains release-gated
- Date: 2026-09-05
- Partially supersedes ADR 0013 for Team Chat after administrator activation

## Decision

Personalization retains identity, phone, sign-in methods and appearance. The new
personal **Model Provider** page contains the owner-bound ChatGPT connection and
agent defaults. Workspace administrators configure Background AI, a dedicated
Team Neura connection/default, and Voice separately. Runtime health is distinct
from credential presence and model availability; absence of ChatGPT OAuth no
longer implies that an API-backed workspace is disconnected.

The provider-neutral catalog is a server-side projection of OpenClaw
`models.list` with account/agent availability, supported reasoning levels and
tool capabilities. Unknown availability is not presented as ready. Tool flags
follow native semantics: omitted `supportsTools` is enabled for legacy
catalog rows, while explicit `false` opts out. Cache keys
include both agent and personal/admin scope, concurrent discoveries coalesce,
failed refreshes retain a visibly stale last-good result, and authentication
changes invalidate the relevant cache. No credentials or endpoints are included
in catalog responses. An hourly reconciliation refreshes configured policies.

PostgreSQL migration 8 stores nonsecret desired policies, revisions, last applied
resolutions, and pending/error state. Compare-and-swap rejects stale edits.
Desired state commits before native configuration is changed; a failed apply
is visibly pending and can be retried. Model/effort fields are applied together
with OpenClaw's native validated batch configuration implementation. Its pinned
CLI can retain provider handles after writing, so a bounded adapter exits after
the native mutation returns, rejecting native errors and incompatible exports.
No utility model, explicit session
pin, job pin, tool policy, or unrelated configuration is rewritten.

Follow-latest is limited to the same provider and workload. The versioned
recommendation registry is a fallback for recommendation metadata that this
runtime does not expose; availability/capability metadata always constrains it.
It never sorts model names to guess a successor. An incompatible explicit effort
holds the previous compatible resolution. Inherited Sol/Astra flagship defaults
are enrolled in follow-latest during reconciliation; explicit and lower-cost
agent defaults become pins. New disconnected accounts remain pending until
their connection can be used. Claude and arbitrary provider switching are not
silently enabled by a model appearing in a catalog.

Neura's conversation picker uses the owner's existing scoped Gateway connection
and native `sessions.patch` ownership checks, expected session identity and
strict user pins. Clearing model/reasoning restores the corresponding agent
default. Automations use the assigned agent's catalog and credentials; model
pins explicitly send `fallbacks: []`. Reasoning `off` is an actual value, not an
absent override. CLI/script jobs retain their existing non-model controls.

## Credential and execution boundaries

The startup controller imports an explicitly configured workspace OpenAI API key
into the native main-agent credential store through stdin, not process arguments.
The key is removed from text Gateway and personal/team CLI environments to avoid
ambient API fallback; the audio controller retains its server-only binding.
Import failure is logged safely and does not take Files/Terminal offline.
Imported credentials persist natively after an environment variable is removed;
operators must revoke/remove the native profile to retire that credential.

Team Neura uses `nl-teamneura` and `openai:nl-teamneura`, with its own native OAuth
refresh owner. It does not copy a member's or background agent's subscription
tokens. This distinction matters: OpenClaw's isolated `agent exec` deliberately
excludes shared OAuth from its temporary read-through scope. A dedicated local
credential avoids creating a second refresh owner. The account must be suitable
and authorized for workspace use; the UI does not assert that a subscription
permits arbitrary pooling.

An administrator must connect the Team account and explicitly confirm/save its
defaults. Until its first successful activation, the legacy summoner-owned route
is retained for compatibility. Afterwards new requests snapshot the last applied
Team model/effort/revision in the same database transaction that queues the run.
They no longer require a personal connection. Later settings changes cannot
rewrite an accepted run. Each execution uses an isolated config with the captured
model and no model fallback, retaining the existing channel-scoped capability and
bounded channel context. A missing dedicated credential fails rather than falling
back to the summoner. This is application isolation inside the existing trusted
shared workspace, not an OS security boundary against co-maintainers.

Background sign-in and status commands explicitly select `main`; multi-agent
runtimes reject ownerless login commands. Sign-in does not reset model defaults
or force-remove existing credentials. Team catalog discovery waits for dedicated
agent provisioning, coalesces concurrent requests, and does not initiate OAuth
or activate the Team policy.

Voice models and voice choice use a separate nonsecret versioned policy. Initial
environment audio pins are preserved. Audio options are a versioned compatible
endpoint registry intersected with API-key model availability on manual refresh;
unverified availability is shown explicitly. Calls and memo transcriptions capture
their configuration before the first await. Text provider/model changes do not
reconfigure audio or replace active WebRTC sessions.

## API and operational contract

- Personal: `/api/account/model-providers/catalog` and `/defaults`.
- Admin: `/api/admin/workspace/model-providers/catalog`, `/defaults`
  (`?workload=team` selects Team rather than Background), `/team/connection`
  (plus `/connect` and `/cancel`), `/voice` (plus `/refresh`).
- Catalog refresh is POST; defaults and voice updates are PUT with a revision.
- Existing `/api/account/openai` and admin workspace ChatGPT routes remain
  compatible. Browser-provided owner IDs cannot choose another personal agent.
- Internal runtime routes require the existing workspace control bearer token.
  Public writes require active/admin authorization, same origin and CSRF;
  expensive catalog/default/login operations are rate limited.

Release requires an operator-managed database/native-state backup, image build,
migration and coordinated control-plane/workspace restart. Deployment and real
provider calls are separate operator steps, not part of repository validation.
After restart verify background API auth, two independent personal accounts,
dedicated Team sign-in/activation, a summon by a member without personal auth,
an explicit automation pin, and WebRTC/memo transcription. Do not claim provider
smoke tests have passed based only on synthetic tests. Rollback must preserve the
native credential stores and restore the prior policy/config backup together;
do not drop policy tables or newly created credentials as an automatic rollback.

## Remaining release gates and extensions

### Managed Codex version consistency

The image points both plugin-local and application-level managed Codex launchers
to the pinned workspace installation, covering source and packaged plugin roots.
OpenClaw's package-first resolution otherwise selects its
older bundled dependency despite a newer Codex being present on PATH. We retain
managed launch semantics and account-isolated homes rather than using the custom
command override, which would alter managed feature discovery. Startup verifies
both managed and shell launcher versions against the release pin; the catalog
exposes that verified version. Refresh performs model discovery, not software
installation or policy application. Model eligibility remains account-scoped;
fixing the runtime version does not guarantee access to a specific model.

Claude personal and shared subscription connections are intentionally unavailable.
They require a provider-approved third-party route and a pinned, per-account native
Claude CLI/SDK integration that owns login/refresh and passes isolation tests.
No pasted subscription tokens, pooled personal logins, connector OAuth substitution,
or API-billing masquerade is implemented. API-only Claude would not fulfill the
subscription requirement. General user-created named connections and advanced
service-tier controls remain extensions beyond the fixed bindings implemented
here; they must not be enabled without corresponding native capability/credential
routing support.

References: [OpenAI model metadata](https://learn.chatgpt.com/docs/app-server#list-models-modellist),
[Astra compatibility](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra),
[Realtime voices](https://developers.openai.com/api/docs/guides/realtime-conversations),
[Claude SDK authentication gate](https://code.claude.com/docs/en/agent-sdk/quickstart).
