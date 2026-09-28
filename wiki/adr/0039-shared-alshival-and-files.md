# ADR 0039: Shared Alshival conversations and filesystem ownership

Status: accepted

Neural Labs names its assistant **Alshival**. Existing `neura` agent identifiers,
local storage keys, protocol enums and invocation aliases remain compatible.
The product name stays Neural Labs.

Files remain ordinary workspace files. Alshival uses its terminal to read and
modify them; neither the Neural Labs MCP server nor a public document REST API
is necessary for this. The authenticated Files UI retains its own internal API.
An optional operator importer verifies historical blobs into a separate archive
and preserves version identity, folder metadata and Trash state. It never
rewrites the working copy or adds a document tool to MCP.

A managed portal can use the optional signed chat bridge. It is a client of the
existing Team Chat store and queue: the bridge does not create another transcript
or runner. Every request checks the live portal grant, workspace, instance,
generation and channel membership. Timestamped instance signatures alone grant
no user access. Request identifiers make channel creation and sending idempotent;
reusing an identifier for different content fails. Cancellation expires the run
capability and interrupts the associated workspace process.

Only explicitly workspace-shared portal conversations may be imported through
the portal's authorized history export. The import preserves original authors,
timestamps, attachment references and message order. Historical authors do not
receive login access. A stable source identity prevents duplicate imports by
different current members. Private portal chats and private attachments are not
eligible for this import. Restricted channels retain their existing membership
checks; sharing chat does not make private chats public.

Standalone installations do not register the managed bridge, need no Alshival
account or subscription, and retain local authentication. Managed hosting links
are optional marketing links, not runtime dependencies. The hosting platform
owns its billing, migration admission and per-workspace activation policy.

Migration failures retain original files and metadata. The importer is resumable
and rejects mismatched bytes, changed historical versions and cross-workspace
manifests. This archive records imported originals; it does not promise automatic
versioning of future filesystem edits. Instance upgrades and activation still
require the normal operator deployment and recovery checks.
