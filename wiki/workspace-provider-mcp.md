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

Keep provider credentials outside Git in root-owned or operator-owned files
with mode `0600`. Set their absolute paths in the ignored root `.env`:

    NEURAL_LABS_MCP_GOOGLE_ENV_FILE=/home/data-team/.config/environment.d/30-global-mcp-google-places.conf
    NEURAL_LABS_MCP_PEXELS_ENV_FILE=/home/data-team/.config/environment.d/31-global-mcp-pexels.conf

The referenced files use Compose env-file syntax:

    GOOGLE_PLACES_API_KEY=...
    PEXELS_API_KEY=...

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
and requires both providers to be configured. The workspace health endpoint is
ready only when both OpenClaw and the local MCP are ready. If the MCP process
exits, the container exits so its restart policy can recover the complete
workspace together.

Public `/mcp`, `/oauth/`, and OAuth discovery routes return `404`.
The retained Entra resource-server implementation is future code and requires a
new security review plus explicit provider-tool wiring before public use.
