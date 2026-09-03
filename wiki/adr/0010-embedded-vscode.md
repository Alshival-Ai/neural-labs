# ADR 0010: Embed code-server in the authenticated desktop

- Status: Accepted
- Date: 2026-09-02

## Context

Developers need a full browser IDE in the same OpenClaw container as the shared
files and terminals. Opening an unrelated local URL in a new tab would bypass
the Neural Labs session boundary, while framing a stock code-server response is
normally rejected by its frame headers. Running a host editor would also move
code execution outside the reviewed workspace container boundary.

Embedding a powerful application at the Neural Labs origin is itself a browser
trust decision. An unsandboxed same-origin frame can interact with its parent
origin if compromised. A restrictive iframe sandbox would disable important VS
Code capabilities, and a dedicated authenticated subdomain would require a
separate ingress and browser-session design.

## Decision

Install the exact, checksum-verified code-server standalone release in the
workspace image. Run it as the existing non-root workspace user with telemetry,
automatic updates, and built-in authentication disabled. Bind it only to
`127.0.0.1:18881`; do not publish this port or create a host service.

Proxy `/workspace/vscode/` through the workspace HTTP service and the existing
Nginx-authenticated `/workspace/` route. Require the immutable forwarded user on
HTTP and WebSocket traffic and the exact public origin for WebSockets and HTTP
mutations. Strip browser credentials and Neural Labs identity headers before
forwarding them to code-server. Preserve only the public host/origin information
required for upstream WebSocket validation.

Rewrite the upstream response policy to permit framing only by the same origin.
Keep the desktop itself non-frameable. Embed the result in a lazy-loaded desktop
app without an iframe sandbox and provide a new-tab fallback. Keep the frame
mounted while minimized so the editor connection and unsaved browser state do
not reset on every dock toggle.

Accept the same-origin frame risk for V1 because the deployment is explicitly a
single mutually trusted developer cell: every approved user already has shell
access and passwordless container sudo, and installed VS Code extensions execute
within that same shared cell. This decision must be revisited before users are
treated as mutually untrusted. A dedicated origin is the preferred future
boundary if the product introduces per-user workspaces.

## Consequences

- VS Code, its integrated terminals, extensions, and files execute only inside
  the existing workspace container.
- Every browser connection remains gated by Neural Labs authentication even
  though code-server itself uses `--auth none` on loopback.
- There is no separately exposed IDE port or second login surface.
- Browser session cookies and asserted Neural Labs identity do not reach
  code-server.
- Approved developers share code-server user data, extensions, settings, and
  filesystem authority. This does not provide conflict-free co-editing.
- A compromised code-server page or trusted-cell extension can affect the
  same-origin desktop browser session. The trusted-cell warning is therefore a
  hard deployment assumption, not merely a collaboration preference.
- A code-server startup or runtime failure holds workspace readiness and causes
  the supervisor to restart the complete workspace service.
