# ADR 0041: Native browser tools and private artifacts

Status: implemented in source; image and destination acceptance are separate gates.

## Decision

Codex and Claude Code receive the same optional `browser` tool through their
existing, revocable native MCP connection. There is no additional AI account,
Responses agent, Gateway, browser subscription, or image-generation API.
Search uses public search pages; search-site challenges are reported rather than
bypassed. The agent can navigate, read snapshots and find text, follow element
references, interact with forms, inspect errors, capture screenshots, upload
approved workspace files, download files, and read PDFs or capture PDF pages.
Screenshots are returned to the model as MCP image content and to chat as artifacts.

## Trust boundary

A lazily started Playwright worker launches the image's Chromium with its sandbox
explicitly enabled. Bubblewrap gives the worker separate user, mount, PID, IPC,
UTS and network namespaces. It receives a disposable home and bounded temporary
filesystem, read-only system dependencies, and a private Unix proxy socket. It
receives no selected CLI home, workspace mount, provider token, runtime state,
private skills, host socket, or public CDP listener. Isolation failure is fatal.

The trusted HTTP/CONNECT proxy resolves destinations, rejects non-public IPv4
and IPv6 addresses (including mapped addresses and mixed DNS answers), and opens
the connection to the validated address. Redirects and subresources use the same
proxy. The network namespace prevents direct bypass. HTTP WebSockets and HTTPS
CONNECT tunnels use the same destination checks. Only public ports 80 and 443
are supported. Operators may deny additional domain suffixes with
`NEURAL_LABS_BROWSER_DENIED_HOSTS` (comma separated). Existing workspace host
firewall policy remains independently required for CLI processes.

Local preview exceptions are explicit: `http://files.workspace.invalid/path/index.html`
creates a random origin confined to that file's directory. Registered apps use
`http://app-name.workspace.invalid/` and the existing `.neural-labs/public-apps.json`
ports 30000–30999. Neither exception grants general loopback access. Files are
opened through directory descriptors with symlink traversal refused.

Every tool call revalidates its execution grant. External click/type/select/press/
upload actions require an approval for the exact page, element and action;
changed pages or targets invalidate that approval. Personal users approve their
own actions and Team approvals retain administrator-only resolution. Unattended
jobs cannot grant interactive approval; read-only policies reject interactions.
Page content remains untrusted input; a permitted public navigation can itself
send HTTP requests, and normal page JavaScript runs in the browser.

## Lifecycle and media

Browser state belongs to one personal conversation and connection, or one Team/
automation run. It is never imported from a user's browser. Personal contexts
expire after 30 idle minutes. Run completion closes Team/job contexts; cancellation
closes the worker. Turn release disconnects proxy sockets and disables authority
until a new live turn reauthorizes reuse. Default capacity is two sessions with
four tabs each, configurable through `NEURAL_LABS_BROWSER_MAX_SESSIONS` (1–8)
and `NEURAL_LABS_BROWSER_MAX_TABS` (1–16). Operations have time limits and temporary storage is capped.

Artifacts are stored below the private native state root, with a SQLite index
binding each artifact to its conversation/actor or Team channel. Retrieval
rechecks current membership, channel access and conversation deletion. Artifacts
are limited to 50 MiB each and 1 GiB in aggregate, with at most 100 attachments
per Team run. MIME detection permits a small
passive media subset; active content downloads as octet-stream. Browser contexts
are disposable; successful artifacts persist with chat history.

`GET`/`HEAD /workspace/api/native/artifacts/:id` supports authenticated download
and byte ranges. `POST` to the same resource accepts `{destination,name,conflict}`
and saves through the Files upload/recovery pipeline with same-origin checks.
It never accepts an arbitrary source URL. Native `artifact-created` events replay
as chat attachments. Team messages carry artifact identifiers and authenticated
URLs; possession of a URL does not grant channel access. Saving to shared Files
is an explicit user action. Conversation deletion removes its artifacts.

## Acceptance

Run the focused native browser/HTTP, MCP, desktop history and approval tests,
then `make validate`. Run `tests/native-browser-smoke.mjs` in each native image
under the documented native AppArmor/seccomp policy with generated state and no
provider credentials. Do not disable Chromium's sandbox or namespace isolation
for a failing architecture. Validate public egress and private destination
rejection before product testing. Source push, image publication and managed
workspace deployment are separate outcomes.

Image generation, persisted browser sign-ins, broad localhost access, unrestricted
browser debugging, and the Team migration are outside this change.
