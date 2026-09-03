# ADR 0003: Use one shared developer workspace

- Status: Accepted
- Date: 2026-09-01

## Context

V1 originally considered one long-running container per developer. OpenClaw
automations prevent idle shutdown, and the initial deployment is intended for a
small team collaboratively building one agent. Per-user cells would reserve
resources and add provisioning machinery without providing value to mutually
trusted collaborators.

Installing the environment directly on the Neural Labs host would make
passwordless developer `sudo` equivalent to host root, exposing authentication,
database, ingress, and deployment secrets.

## Decision

Run one always-on shared workspace service in the existing Compose project. All
active Neural Labs users are trusted co-maintainers of the same OpenClaw agent,
home directory, automations, and Codex login. Give the non-root workspace user
passwordless `sudo` only inside the container.

Persist the home, OpenClaw state, and OpenClaw auth-profile key in named volumes.
Pin the official OpenClaw base image by immutable digest and install an exact
Codex CLI release in the derived image. Serve the Neural Labs desktop shell from
that same image so custom OpenClaw applications share the runtime boundary.
Publish both the desktop and Gateway only on host loopback and place them on a
dedicated bridge whose gateway IP is the only OpenClaw trusted proxy.

Host nginx authenticates every desktop, asset, and Neura WebSocket request with
a control-plane subrequest, overwrites forwarded address and identity headers,
and sends the immutable Neural Labs user ID to the workspace. The generic
OpenClaw Control UI is disabled; the only public Gateway surface is the exact
`/workspace/neura/socket` WebSocket path. OpenClaw uses trusted-proxy device
auto-approval and limits authenticated desktop clients to the main agent and
the read, write, approvals, and questions operator scopes.

Neura exposes shared main-agent chat sessions. Any approved user may create,
rename, archive, restore, or permanently delete those sessions and may resolve
an inline agent approval. These are collaboration capabilities, not
administrator-console privileges. The control plane receives no Docker socket
and reads health information from a container-network status endpoint. The
desktop shares that status listener, which is also published only on loopback
for Nginx.

OpenClaw, not the control plane, owns ChatGPT/Codex OAuth. An administrator can
start or cancel OpenClaw's fixed device-code flow from the administrator-only
Settings app inside `/workspace`. The
control plane calls a narrow workspace endpoint using a dedicated generated
token shared only by those two containers; it cannot submit an arbitrary
command. The endpoint returns provider state plus the short-lived verification
URL and user code, never the access token, refresh token, or OpenClaw auth
database. The browser receives the same short-lived pairing fields. Provider
credentials remain in the persistent workspace volumes.

Do not grant trusted-proxy authentication to container-loopback clients. The
fixed provider controller may run OpenClaw's device-code CLI locally, but after
that process exits it verifies the result by rereading the local provider
inventory. OpenClaw's best-effort request to refresh the running Gateway may be
rejected without invalidating an OAuth profile that was already persisted.

The Files app exposes a narrow HTTP API below `/workspace/api/files*`. Nginx
applies the same control-plane authentication subrequest and immutable user
header used for the desktop. Mutations additionally require the exact public
origin. The workspace service confines every operation to
`/home/node/workspace`, rejects traversal and symbolic links, streams uploads to
atomic temporary files, and forces downloads to attachments. Approved users
may list, upload, create folders, download, and permanently delete shared files;
the browser API cannot address the rest of the container or the host.

The same authenticated API prefix exposes a one-way Server-Sent Events stream.
A recursive workspace watcher publishes coalesced path invalidations to all
connected approved users, including for changes created outside the Files UI.
Browsers reconcile by re-listing their current directory over the confined HTTP
API. The stream adds no write capability and does not cross a new trust boundary.

The Editor extends that same confined API with UTF-8 text create, read, and save
operations. Text creates are exclusive, saves use an atomic replacement, and a
content-derived revision rejects stale writes rather than silently overwriting
another developer's newer save. Text payloads are limited to 16 MiB and binary
content is rejected. The Editor cannot address paths outside the shared
workspace and does not execute file content.

The Terminal app adds a PTY service inside the workspace container. It never
mounts or proxies a host shell. Personal sessions are visible only to the
immutable Neural Labs user ID that created them. Team Terminals are visible to
all approved workspace users and intentionally accept concurrent input from
every connected participant. Their creator, or a Neural Labs administrator,
may end them for everyone. All shells run as the workspace user, start in the
shared `/home/node/workspace` directory, and inherit only an allowlisted runtime
environment.

PTY processes belong to the workspace service rather than a browser socket, so
they survive tab closure, sleep, and network loss but end when the workspace
container is recreated. The browser obtains a short-lived, one-use WebSocket
ticket over the same-origin authenticated HTTP API and presents it as a
WebSocket subprotocol. The upgrade independently requires the exact public
origin and the Nginx-injected user identity. Tickets cannot be reused or moved
between users. A bounded output ring permits replay or sequence-based resume,
and ping/pong heartbeats plus indefinite client reconnect prevent idle network
devices from silently orphaning a view.

Each Team Terminal elects one connected view as its layout leader. Only that
view may resize the shared PTY; any participant may explicitly take leadership
immediately. This avoids competing window sizes while preserving equal live
input rights. Terminal output is treated as untrusted terminal data. The client
does not enable OSC 52 clipboard access; copying and pasting require explicit
local keyboard or toolbar actions.

The desktop may retain non-authoritative presentation state in same-origin
browser storage, namespaced by immutable Neural Labs user ID. This includes
window instances and geometry, application navigation choices, terminal session
identifiers, and Editor file paths. It excludes file contents, unsaved edits,
terminal contents and keystrokes, conversation contents and drafts, provider
state, credentials, tokens, and one-use WebSocket tickets. Restored resources
are fetched again through their authenticated APIs. Device state is intentionally
not synchronized between browsers.

The VS Code desktop app extends the same shared container with a loopback-only
code-server process. Its authenticated reverse proxy and accepted same-origin
iframe trust are specified separately in
[ADR 0010](0010-embedded-vscode.md). It does not create a host listener or a
per-user isolation boundary.

## Consequences

- The deployment has no per-user allocator, capacity schema, Docker-privileged
  provisioner, or idle-stop policy.
- Approved users can see or alter shared files and credentials; application
  roles do not create secret isolation inside the workspace.
- Approved users can delete shared Neura transcripts after an explicit client
  confirmation. V1 has no per-conversation ownership or retention policy.
- Approved users can also permanently delete shared workspace files and folders
  after confirmation. The Files app has no per-user ownership or recoverable
  trash in V1.
- Workspace `sudo` cannot administer the host or sibling services, but a
  compromised workspace may use its allowed outbound network access.
- Named-volume state must be stopped briefly and included in protected backups.
- Image-layer package changes are declarative; ad-hoc system package installs
  are lost on recreation while home-directory content persists.
- Desktop application code ships with the workspace image and can integrate
  directly with OpenClaw, but it must continue treating the control plane as the
  source of user authentication and authorization.
- The control plane can request one allowlisted provider-login operation in the
  workspace. Rotating `NEURAL_LABS_WORKSPACE_CONTROL_TOKEN` requires recreating
  both containers but does not invalidate the OpenAI account credential.
- A process inside the workspace is not implicitly a trusted Gateway proxy.
  Internal CLI status refreshes over loopback may be rejected; provider-login
  completion is verified against the local auth-profile inventory instead.
- Personal terminal metadata is user-isolated, but shell commands still operate
  inside the mutually trusted shared workspace and can read shared container
  state. Team Terminal keystrokes and output are intentionally collaborative.
- Terminal processes survive browser disconnection without an idle timeout.
  They consume workspace resources until a user ends them or the workspace
  container is recreated; per-user, per-team, and global limits bound growth.
- Clearing browser site data removes only the device's desktop layout. It does
  not delete server-side workspace state. Shared or managed browsers still need
  their normal profile-clearing policy because file paths and session labels are
  retained as local presentation metadata.
- A future deployment for mutually untrusted users must introduce separate
  container or VM trust boundaries rather than relying on OpenClaw roles.
