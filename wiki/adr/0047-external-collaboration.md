# Private external collaboration on the native execution engine

External participants use the same durable native turn engine as human chat.
They receive scoped, expiring credentials tied to an active member and one
explicit model connection generation. They cannot supply an arbitrary owner,
provider credential, or portal delegation.

The control plane owns credential hashes, private session bindings and short
renewable operation leases. The workspace owns native turns, event cursors,
approvals and cancellation. Every operation revalidates the current binding;
quiet running turns renew authorization periodically. Provider logs are isolated
per collaboration session. Credentials and lease capabilities are excluded from
activity events.

Managed portal execution adds signed active-turn authorization. It never exposes
the portal application key to native tools. A disconnect after dispatch leaves
an uncertain outcome that is reconciled through durable request IDs and events;
it does not dispatch a second provider turn. Network disconnection cannot undo
an already applied external side effect.

This boundary remains optional and contains no subscription or billing rules.
See [External agent collaboration](../external-agent-collaboration.md).
