# ADR 0030: Preference-aware automation notifications

> Design history: for current instructions, see [Run and manage automations](../automations.md).
> See the [decision index](../maintainer-reference.md#architecture-decision-history) for amendments and related records.

- Status: Accepted
- Date: 2026-09-07

OpenClaw remains the scheduler. PostgreSQL stores per-user channel consent,
per-job subscriptions, structured notification events and a per-channel outbox.
A protected workspace bridge exposes bounded job/run identities and outcomes,
not raw scheduler payloads. The control plane reconciles finished runs and can
notify about failures even when an agent fails before producing a summary.

The shared trusted agent can stage summaries for an actual scheduler run or
request a direct update for a workspace member. It cannot provide arbitrary
phone/email destinations or override current subscription/consent checks.
Automation summaries wait for the final scheduler outcome. Unique event keys
and per-recipient/channel rows suppress duplicate callbacks. External provider
acceptance is distinct from delivery; interrupted/ambiguous sends are retained
as unknown and are not blindly repeated.

Neura updates are account-scoped database records rendered alongside a dedicated
private conversation. The user creates that conversation through their normal
Gateway identity. A protected bridge verifies the session belongs to their
personal agent and is private before storing its association. Receiving an
update does not execute an agent turn. Only a user's reply includes the visible
updates as reference context for Neura.

Email uses the existing control-plane Entra credential to acquire an application
Graph token and send as the administrator-configured mailbox ID. Credentials,
mailbox tokens and subscriber addresses are not exposed to the model or frontend.
Users explicitly opt in to email to their account address. SMS retains verified
phone and opt-in checks. Settings changes are rechecked at dispatch time.

The deployment adds database tables and coordinated workspace/control-plane
interfaces. Deploy via the explicit operator lifecycle with a state backup;
repository validation never sends messages or mutates deployment state.
