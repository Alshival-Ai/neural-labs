# VS Code desktop app

The VS Code dock icon opens code-server inside a normal Neural Labs desktop
window. The editor starts on `/home/node/workspace`, so Files, Editor, Terminal,
Neura tools, and VS Code all operate on the same shared project tree. The
window keeps its iframe mounted while minimized, preserving the browser editor
connection when it is restored. **Open in tab** remains available for a larger
standalone view or as a recovery path.

This is the Code OSS browser experience supplied by code-server. It is a shared
development environment, not a per-user IDE: extensions, editor settings,
terminals started by VS Code, and workspace files all live in the trusted
workspace container. Two developers can connect at once and immediately see
saved file changes, but code-server alone does not provide Live Share cursors or
conflict-free simultaneous editing of the same unsaved buffer.

## Runtime and routing

The workspace image installs the exact code-server `4.133.0` standalone release.
Both supported architecture archives are verified against their release SHA-256
digests during the image build. The workspace supervisor starts it as the
unprivileged `node` user with telemetry and update checks disabled, no built-in
password, and a listener fixed to `127.0.0.1:18881`. The listener is not
published by Compose.

The workspace HTTP service reverse-proxies `/workspace/vscode/` to that
loopback listener. Host Nginx performs the same control-plane session check as
the rest of `/workspace/` before traffic reaches the proxy. The proxy also:

- requires the Nginx-injected immutable user ID on HTTP and WebSocket requests;
- requires the exact Neural Labs public origin for WebSockets and HTTP
  mutations;
- removes the Neural Labs session cookie, authorization, email, role, and user
  headers before forwarding traffic;
- preserves the public Host and Origin values needed for code-server's
  WebSocket checks; and
- replaces upstream frame policy with `frame-ancestors 'self'` and
  `X-Frame-Options: SAMEORIGIN`.

The desktop iframe intentionally is not sandboxed. VS Code depends on workers,
storage, downloads, clipboard integration, and nested webviews that a useful
sandbox configuration would break. Same-origin embedding therefore admits
code-server into the desktop browser origin. This is accepted only because V1
already treats every approved workspace developer and executable workspace
extension as trusted; see [ADR 0010](adr/0010-embedded-vscode.md).

## Operations

VS Code readiness is part of the workspace health check. If its process exits,
the workspace supervisor stops the remaining children so Compose can recreate a
complete service rather than leave a partially working desktop.

The editor's user data and extensions live below
`/home/node/.local/share/code-server` in the persistent shared home volume. Do
not place tenant credentials in editor settings or extension configuration.
Add system dependencies to `workspace/Containerfile`; packages installed
interactively disappear when the workspace image is recreated.

The code-server listener is intentionally inaccessible from the public network
and must remain absent from Compose `ports`. Operators can confirm its process
and logs through the existing workspace commands:

```bash
sudo bin/neural-labs workspace status
sudo bin/neural-labs workspace logs
```
