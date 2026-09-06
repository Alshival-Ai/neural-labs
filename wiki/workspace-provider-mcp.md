# Workspace-local provider MCP

Neural Labs V1 runs one provider MCP as a child of the shared workspace
container. It listens only on `127.0.0.1:8792` inside that container,
is automatically registered with the shared OpenClaw configuration as
`neural-labs-tools`, and has no published container or host port.

## Tools

- `google_places_search`: search Google Places with bounded result counts.
- `google_place_details`: fetch bounded fields for one place.
- `google_place_photo`: resolve one place photo to a safe Google URL.
- `google_geocode_address`: geocode a postal address.
- `google_reverse_geocode`: reverse-geocode coordinates.
- `search_gif`: return 8-20 KLIPY GIF choices with selection guidance.
- `pexels_search_photos`: return 8-20 reviewed photo choices and attribution.
- `pexels_search_videos`: return 8-20 progressive MP4 choices and attribution.
- `pexels_download_media`: download a signed search selection safely into an
  existing project.

Google Places and Geocoding use the same Google API key. Pexels search results
include one-hour signed download tokens. The download tool accepts only an
existing DNS-safe project slug and a normalized destination below
`site/assets/`. It rejects traversal, symlink escapes, unsafe redirects,
unexpected media types, oversized files, and overwrites.

## Credentials

Administrators can manage Google Maps, KLIPY, and Pexels API keys in
**Settings → Plugins**. Keys are encrypted in the control-plane database; browsers
receive only status. Settings overrides deployment keys until an administrator
chooses **Use deployment configuration**. Disconnect disables the provider and
does not fall back to an environment key.

For deployment-managed credentials, keep them outside Git in the ignored root
`.env`, which must remain mode `0600`:

    GOOGLE_PLACES_API_KEY=...
    KLIPY_API_KEY=...
    PEXELS_API_KEY=...

An operator may maintain the same values in host environment.d files, but must
materialize them into the protected root `.env` for Compose. This also keeps
them in the standard encrypted recovery set. Snap-confined Docker installations
cannot read hidden home paths such as `~/.config/environment.d` directly.

Compose injects these values only into the trusted workspace container. All
approved workspace users share that trust boundary and the container retains
its documented unrestricted sudo capability. Do not enable this architecture
for mutually untrusted tenants.

The local MCP and workspace HTTP process independently fetch leased configuration
from the token-authenticated control plane every 15 seconds. Each new MCP request
uses a fixed snapshot; terminal GIF searches use the current KLIPY configuration.
A confirmed configuration survives a transient outage for at most 60 seconds.
Startup failure or lease expiry disables provider-backed tools until refresh
succeeds. Existing requests may finish with their original snapshot. No workspace
restart is needed for Settings changes; environment changes still require normal
operator deployment steps.

Health and Settings expose saved/applied revisions without keys. Google Maps
checks Places and Geocoding separately. KLIPY must be applied in both processes
before Settings marks it applied. Terminal selection tokens are invalidated when
its configuration changes, and searches spanning a change must be retried.
See [ADR 0029](adr/0029-settings-provider-credentials.md).

## Project and provenance layout

Projects persist in the workspace volume until manually deleted:

    /home/node/workspace/projects/<business>/
      site/
        assets/
      .neural-labs/
        media/
          <sha256>.json

Every downloaded asset has a provenance record containing its source URL,
Pexels page, creator attribution, original query, content type, size, digest,
destination, and download time. Generated sites must retain appropriate Pexels
credit and must not claim stock media depicts the actual business.

The normal workspace backup archives all of `/home/node`, including projects
and provenance.

## Operations

`bin/neural-labs doctor` checks `/healthz` through `docker compose exec`
and requires all three providers to be configured. The workspace health endpoint is
ready only when both OpenClaw and the local MCP are ready. If the MCP process
exits, the container exits so its restart policy can recover the complete
workspace together.

The workspace health response includes a secret-free MCP status summary: its
loopback endpoint, global OpenClaw server name, shared-agent scope, provider
configuration flags, and registered tool names. The control plane uses that
summary for the locked **Neural Labs Tools** entry under Settings → Plugins; it
does not reconstruct or advertise the retained public MCP configuration.

Public `/mcp`, `/oauth/`, and OAuth discovery routes return `404`.
The retained `mcp.alshival.ai` hostname uses
`deploy/nginx/mcp.alshival.ai-disabled.conf`, which preserves ACME renewal but
returns `404` for every non-challenge request.
The retained Entra resource-server implementation is future code and requires a
new security review plus explicit provider-tool wiring before public use.

## Interactive Terminal tools

The same local server also registers `list_terminals`, `open_terminal`,
`read_terminal`, and `send_terminal_input`. These tools work with the Terminal app
and the user, including sessions opened independently of Neura. They are available
without Google, Pexels, or KLIPY credentials.

An authenticated Neura message receives an expiring terminal context capability
and `recentTerminals`: up to three snapshots chosen by per-user human interaction
recency, with up to 4 KiB of eligible output each. Snapshots remain fixed for queued
messages. Team message envelopes carry only the opaque capability into the run
queue; the workspace validates its owner/channel and sharing before adding the
captured snapshot to the model prompt. Legacy Team clients without a snapshot
capability receive context at run start.
The local MCP forwards it to the token-protected workspace terminal bridge at
`/internal/terminal-agent`. User IDs supplied by the model do not authorize access.
The workspace checks current user status, terminal ownership, channel membership,
and participation mode on each operation, including after a pending read wakes.

`open_terminal` uses a stable request ID and optional command, title, working
directory, channel ID, and `agentMode` (`shared` or `status-only`). Without a channel
it opens a personal terminal for the authenticated conversation user. In a Team
Chat it stays in that channel. `read_terminal` accepts a sequence cursor, up to
64 KiB output and a wait of up to 20 seconds. Omit the cursor for recent output;
use `afterSequence: 0` to read forward through retained history. Responses flag
missing/truncated history and expose a continuation cursor. `send_terminal_input`
requires an explicit terminal ID and accepts literal text or an interrupt, without an implicit newline. An omitted read target uses the newest terminal captured for that message.

Capabilities expire after one hour and are held in workspace memory. The UI hides
the machine context from rendered chat messages. The OpenClaw transport retains
it in its underlying conversation input; treat that runtime state as private.
Capabilities, terminal tickets, and raw input are not added to application logs.
The terminal tools cannot resume sharing or access output produced while paused.
See [Terminal](terminal.md) for user controls and limitations.

At workspace startup, the managed block from `workspace/terminal-guidance.md` is
installed in the shared workspace `AGENTS.md`, preserving other instructions.
The source is also reflected in the MCP tool descriptions. Deploy the workspace
image to activate both the tools and desktop integration; validation does not
change the running workspace or host.


## Team Terminal GIF picker

The workspace HTTP server reuses the KLIPY client from the MCP build, with the
same leased server-side KLIPY configuration (Settings key or inherited
`KLIPY_API_KEY`). The existing `search_gif` tool contract is
unchanged. The terminal picker uses `/v2/featured` and `/v2/search`, requests
`contentfilter=off`, and retains provider ordering and pagination. It displays
“Search KLIPY” and “Powered by KLIPY”; accepted sends register a share with KLIPY.
Share reporting failure does not interrupt the reaction.

`GET /workspace/api/terminals/:id/gifs?q=...&pos=...` requires authentication and
current Team Terminal access. Results include temporary selection tokens scoped
to the actor and terminal. WebSocket GIF reactions submit those tokens, never
arbitrary media URLs. API errors and responses do not expose the provider key.

See [ADR 0027](adr/0027-team-terminal-reactions.md) for the browser media boundary
and token lifecycle. No provider dashboard or production configuration changes
are needed when the existing KLIPY key is configured.
