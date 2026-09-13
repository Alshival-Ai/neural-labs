# Documentation audit — September 2026

This is a documentation inventory and consistency audit against the repository's
CLI, Compose/Nginx files, release manifest, account routing, and desktop sources.
It does not certify a deployed host or replace a runtime/security review.

## Findings addressed

| Finding | Change |
|---|---|
| Home was a flat directory with release records and 33 ADRs ahead of useful user instructions | Replaced it with a personal deployment walkthrough and a short next-steps section |
| The sidebar and landing-page lists were maintained separately | The [guide directory](navigation.md) now also generates the sidebar |
| First setup omitted host Node.js, required TURN address replacement, and actual Nginx site activation | Added prerequisites, configuration values, TLS template adaptation, activation, and expected checks |
| `doctor` was described as requiring “both” providers | Documented its requirement for all three optional providers and the limitations of a basic-install health result |
| Microsoft web-login setup included unavailable public MCP API exposure and Codex callbacks | Removed those steps from web login and retained the future implementation in its own clearly labeled reference |
| Team Chat described public MCP as available and always used the author's personal account | Documented disabled public ingress and dedicated Team account activation/routing |
| Personal ChatGPT and sign-in method instructions pointed to Personalization | Corrected current guides to Model Provider and Security |
| The workspace overview described permanent deletion and outdated shared-chat/account behavior | Replaced it with a first-session guide and consolidated current privacy/persistence explanations |
| Account billing rules were scattered across ADRs 0013, 0023, 0032, and 0033 | Added a current account/workload table covering personal, Team, scheduled/manual, terminal, and audio use |
| The Automations guide mixed everyday use with a long deployment-specific site-generation chronology | Rewrote the task guide and preserved the chronology in [workflow history](reference/site-generation-history.md) |
| Skill edit/delete permissions and member manual automation runs were inconsistent across pages | Updated the Skills and Automations guides from the current permission boundaries |
| The Settings guide hard-coded the previous SMS runtime version | Linked the current reviewed release manifest |
| The web development note conflated console and desktop code | Corrected their source locations and made the static local-preview command bind to loopback |
| ADRs could be mistaken for current setup instructions | Added a current-guide notice to every record and a grouped decision index with known amendments |
| Link checking ran only at publication time | Added export validation and isolated publication regression tests to `make validate` |

## Content disposition

No existing ADR filename or published page identity was removed. Keeping stable
links preserves design/security evidence while taking the records out of the
main user journey. No trust boundary changed in this documentation update.

| Existing content | Place in the documentation |
|---|---|
| Deployment, authentication, Entra, passkeys | Set up and manage guides |
| Workspace, Neura, Team Chats, Files, Terminal, VS Code, Skills, Automations, desktop state | Use your workspace |
| Settings, provider MCP, backup/restore, OpenClaw upgrades | Manage your instance |
| Four application release records, two runtime assessments, changelog | [Release history](release-history.md) |
| All 33 architecture decisions | [Decision history and current-guide mapping](maintainer-reference.md#architecture-decision-history) |
| Retired Editor and standalone web deployment | Historical references, with links to replacements |
| Public Entra MCP | Future implementation reference; not part of supported setup |
| Web frontend and wiki publishing | Maintainer reference |
| Roadmap and tracker | Project planning, separate from user instructions |
| Site-generation rollout/design notes formerly in Automations | Optional workflow history |

## Follow-ups requiring implementation or operator work

These findings cannot be resolved by changing user instructions alone:

- **Basic-install health checks:** `bin/neural-labs doctor` and the final checks
  in update/restore require three optional provider configurations. A future
  CLI change should distinguish missing optional integrations from failed core
  services. The guides now explain the current result accurately.
- **TURN isolation policy:** the existing Compose `turn` service uses
  `network_mode: host`, while repository instructions prohibit adding host
  networking. The docs identify the current relay behavior without extending
  that exception to application containers. Reconcile the deployment and policy
  through a dedicated design/security decision before changing this boundary.
- **Fresh-host acceptance:** the quick start was checked against source, not
  executed on a new Linux host with real DNS/TLS, TURN, signup, and paid provider
  accounts. Record that acceptance separately, including host sizing. Default
  CPU/memory limits are not verified minimum requirements.
- **Background CLI recovery:** the legacy `workspace provider-login` command
  does not specify `main`, although the model-account design records require
  explicit agent selection for multi-agent runtimes. The current user guide
  directs background pairing through Settings; verify and align the CLI in a
  separate implementation change.

## Ongoing documentation rules

User guides describe tasks and current behavior. Release records preserve dates
and evidence. ADRs preserve design rationale, and amendments should link to the
replacement decision plus the current guide. Keep implementation chronology out
of the normal setup and usage flow.

When a UI action moves, update all current guides, not historical release text.
When moving content, retain an old entry point or explicitly review the old wiki
page during publishing. Validate the export before writing to the wiki checkout.
