# External agent collaboration

An external agent can ask Neura to work in a private native conversation using a
member's explicitly selected model connection. This is optional: ordinary chat,
Terminal, Projects, and independent self-hosting do not require an integration.

In **Settings → Security → External agent collaboration**, choose your personal
or an explicitly shared model connection, model, name, and permissions. Create a
credential and copy it before dismissing it. Only its hash is stored. Credentials
expire after 30 days in this interface and can be revoked from the same page.
The API supports lifetimes from 1 to 90 days. Revocation and current membership
are checked again during execution, including a 10-second renewal while the
provider is quiet. Loss of authorization aborts execution; it does not promise
that a remote side effect was undone.

The default permissions are `read`, `run`, and `cancel`. `approve` is separate:
only grant it to an external participant permitted to approve native operations
on your behalf. “Allow All” includes that permission.

## HTTP and MCP contracts

Send `Authorization: Bearer <credential>` to `/api/collaboration/v1`, or connect
an MCP client to `/api/collaboration/mcp` with the same header. Browser cookies
alone cannot authenticate either interface. The MCP `collaborate` tool accepts
the same object in its `request` argument:

| Operation | Fields | Result |
| --- | --- | --- |
| `create` | `requestId` UUID | Private `session` UUID |
| `send` | `session`, `requestId` UUID, `text` | Durable native turn `id` |
| `follow` | `session`, `after` cursor, `waitMs` up to 15000 | Ordered events |
| `cancel` | `session`, `turn` | Cancellation request |
| `approve` | `session`, `approval`, provider `decision` object | Approval resolution |

Persist request IDs before sending. Reuse them for the same request only.
After a transport failure, follow the existing session before deciding what to
do: a lost response is not evidence that execution never started. Native events
include the initiating participant, request ID, approval requests, tool activity,
output, and terminal outcome. Never interpret `unknown` as success or retry it
automatically. Cancellation also cannot undo an already completed side effect.

`GET /api/collaboration/v1/sessions/<session>/events` provides a bounded SSE batch.
Reconnect with `Last-Event-ID` to resume. This intentionally rechecks credentials
and membership on each batch. Different credentials cannot inspect one another's
sessions, even when issued by the same member.

## Isolation and managed integrations

Each collaboration session has its own provider history home. It uses the
selected connection's credentials through the existing native filesystem broker,
without sharing that connection's other conversation logs. It still acts as the
issuing member in that instance's workspace; a credential does not create a new
filesystem sandbox or grant access to another member's personal connection.

Managed installations can additionally accept signed active-turn delegations.
They bind the portal conversation, user, workspace, runtime generation, and turn
attempt. Portal tools are forwarded with a short execution lease; permanent
portal credentials stay outside the workspace. The public collaboration API
cannot mint a portal delegation. Model changes or revoked connections require a
new conversation rather than silently rebinding a running conversation.

A source upgrade must update both control-plane and workspace images. Upgrading
only one component is insufficient. Follow [Workspace updates](workspace-updates.md)
and verify creation, output, approvals, revocation, and disconnect reconciliation
before enabling a managed integration.
