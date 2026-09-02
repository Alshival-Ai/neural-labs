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

Keep provider credentials outside Git in the ignored root `.env`, which
must remain mode `0600`:

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
summary for the read-only MCP area in Settings; it does not reconstruct or
advertise the retained public MCP configuration.

Public `/mcp`, `/oauth/`, and OAuth discovery routes return `404`.
The retained `mcp.alshival.ai` hostname uses
`deploy/nginx/mcp.alshival.ai-disabled.conf`, which preserves ACME renewal but
returns `404` for every non-challenge request.
The retained Entra resource-server implementation is future code and requires a
new security review plus explicit provider-tool wiring before public use.
