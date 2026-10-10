# ADR 0044: Personal chat command approvals

Status: Accepted

## Decision

Expose Ask when needed / Do not ask in the private chat composer. Default to
never for signed-in accounts without a saved preference; retain explicit on-request choices.
Save the non-secret preference per actor in browser local storage;
submit it explicitly only for turns.start. The control plane validates the enum
and purpose, binds it to the authenticated actor/session/connection/generation
in a durable execution lease, and revalidates the same policy for the whole turn.
The internal purpose `turns.start:no-prompt` persists the choice in the existing
lease table; verification returns the logical `turns.start` purpose and the bound
approval mode. No schema migration is needed. Old clients and existing leases
retain the previous behavior.

Codex receives approvalPolicy=never with sandbox=workspace-write and network
access under host egress policy. It never receives danger-full-access. Claude
retains its structured permission protocol: after live grant validation, the
broker permits only configured native command/file tools and Neural Labs MCP
tools without prompting. Unknown tools are denied; read-only grants cannot use
write/command tools. MCP handlers retain independent capability enforcement.
The no-prompt branch does not apply to background execution. Browser action
confirmation and user questions remain separate.
Codex empty MCP form confirmations follow the bound no-prompt policy after
revalidation. Forms requesting values still require user input. Interactive MCP
confirmations use elicitation action/content responses rather than command decisions.

The UI locks changes during active/queued work. Other tabs cannot mutate a
running lease. Turn-started events retain the selected approval mode. Neither
saved model preferences nor Team/background authorization are widened.

## Verification

Cover explicit/default policy, actor separation, persistent lease renewal and
revocation, rejection of no-prompt requests for non-chat operations, new/resumed Codex sandbox parameters,
Claude allowed/unknown/read-only tools, and cancellation on lease revocation.
Use synthetic accounts in isolated PostgreSQL and fake protocol streams; a
real provider inference is an owner product test, not required to set policy.
