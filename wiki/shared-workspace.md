# Shared developer workspace

Neural Labs V1 provides one continuously running OpenClaw environment shared by
every approved user. It is a trusted collaboration cell, not a security boundary
between developers. Files, agent state, automations, and model credentials are
shared.

The workspace remains a container so its passwordless `sudo` cannot administer
the host, PostgreSQL, Nginx, Docker, or the control-plane secrets. It has no
Docker socket, host home mount, privileged mode, host network, host PID/IPC
namespace, or host devices. Its desktop and Gateway listeners are published
only on loopback.

## Versions and resources

The initial release pins:

- OpenClaw `2026.8.2` using the official multi-architecture image digest;
- Codex CLI `0.152.0` as an exact npm package version;
- code-server `4.133.0` from checksum-verified architecture-specific release
  archives; and
- 10 CPUs and 16 GiB of memory for the shared container.

The root `.env` controls the image reference, exact versions, loopback port,
CPU/memory ceiling, and the dedicated Docker subnet. Keep the OpenClaw tag and
digest aligned. If the subnet overlaps another Docker or host network, choose a
different private `/29` and set its first usable address as
`NEURAL_LABS_WORKSPACE_PROXY_IP`.

The container is always on with `restart: unless-stopped`. Do not schedule idle
shutdown: OpenClaw automations and heartbeats require the Gateway to remain
running.

## Initial setup

Start the cluster and install the reviewed nginx configuration using the
explicit host steps in the [container deployment guide](container-deployment.md).
After the initial administrator can sign in, open `/workspace`, launch
**Settings** from the dock, choose **Workspace**, and select **Connect ChatGPT
account**. Neural Labs requests an OpenAI device code from
OpenClaw inside the workspace container. Open the displayed OpenAI URL, sign
in, and enter the one-time code. Keep the administrator page open until it
reports **Connected**.

Device-code login may first need to be enabled in the ChatGPT account or
workspace security settings. The OAuth access and refresh tokens are written by
OpenClaw to its own persistent agent auth store. They are never returned to the
browser, copied into the control-plane database, or placed in the root `.env`.
Treat the workspace volumes and their backups as passwords.

The operator CLI provides the same OpenClaw flow as a recovery path:

```bash
sudo bin/neural-labs workspace status
sudo bin/neural-labs workspace provider-login
```

The separately installed Codex CLI has its own account cache. Authenticate it
only when developers need to run `codex` directly in the workspace terminal:

```bash
sudo bin/neural-labs workspace codex-login
```

That CLI cache does not configure Neura. Neura always sends requests through
OpenClaw, whose canonical model route is `openai/*` and whose bundled Codex
runtime is enabled by the workspace image.

Official references:

- [Codex CLI](https://learn.chatgpt.com/docs/codex/cli)
- [Codex authentication and headless device login](https://learn.chatgpt.com/docs/auth)
- [OpenClaw OpenAI provider and ChatGPT/Codex OAuth](https://docs.openclaw.ai/openai)
- [OpenClaw Docker deployment](https://docs.openclaw.ai/install/docker)
- [OpenClaw trusted-proxy authentication](https://docs.openclaw.ai/gateway/trusted-proxy-auth)

## Access and persistence

Active users enter the Neural Labs desktop at `/workspace`. The React desktop is
built into and served by the same container as OpenClaw, so custom skills,
automations, and GUI applications can work against the shared runtime without a
host-level service. The desktop uses responsive wide, tablet, and mobile
Spectrum Paper artwork as its default wallpaper.

Window visibility, stacking, geometry, and safe application presentation state
are retained per signed-in user in each browser profile. They are not synced
between devices and do not include credentials, terminal contents, conversation
bodies, or file bodies. Static hashed bundles and responsive wallpaper assets
use browser caching appropriate to their update model. See [Desktop windows and
device state](desktop-state.md).

Neura is the first desktop app. It is the product identity for OpenClaw's
`main` agent and provides shared chat history, streamed responses, compact tool
activity timelines, inline approvals, file/image attachments, and run steering.
The transcript follows live WebSocket updates at the bottom without overriding
an intentional upward scroll. The window is a singleton with drag,
eight-direction resize, minimize, maximize, and close controls; minimizing
keeps its live UI mounted, and closing it does not stop an agent run. On narrow
screens it becomes a full-screen app with a history drawer.

Files is the desktop browser for `/home/node/workspace`. Approved developers can
navigate folders, upload files by picker or drag and drop, create folders,
download files, and permanently delete files or folders after confirmation.
Uploads stream into atomic temporary files and default to a generous 2 GiB cap
per file. Files can also create and open shared UTF-8 documents in the Editor,
which provides atomic, version-aware saves and preserves unsaved drafts while
its window is minimized or closed. See the [Files guide](files.md) and
[Editor guide](editor.md).

Terminal provides private per-user PTYs plus opt-in, multi-writer Team
Terminals. Shells continue running when their browser view disconnects and have
no idle timeout; they end when explicitly terminated or when the workspace
container is recreated. See the [Terminal guide](terminal.md) for session,
collaboration, clipboard, and reconnect behavior.

VS Code runs as code-server inside the same container and opens from the desktop
dock in an embedded window, with a new-tab fallback. Its listener is loopback
only and every proxied HTTP and WebSocket request remains behind Neural Labs
authentication. Editor settings and extensions are shared in the persistent
home volume. See the [VS Code guide](vscode.md) for routing, framing, persistence,
and trusted-origin details.

All approved users can create, switch, rename, archive, restore, and delete any
Neura conversation. Deletion requires a confirmation but is permanent. Press
Enter to send or steer an active run, Ctrl/Cmd+Enter to queue a follow-up, and
Shift+Enter to add a line. Active-run steering remains enabled across
intermediate transcript commits and when a run began before the app opened.
Queued follow-ups are shown in FIFO order and are owned and advanced by the
Gateway rather than a browser timer. The raw OpenClaw Control UI is disabled.
Nginx exposes only the authenticated `/workspace/neura/socket` Gateway WebSocket;
navigating to `/workspace/openclaw/` returns `404`.

Nginx performs a session subrequest for every desktop, asset, API, and Neura
WebSocket connection, strips caller-supplied identity headers, and injects the
immutable Neural Labs user ID. Pending, rejected, disabled, and anonymous users
cannot reach either the desktop or the Gateway.

Three named volumes preserve the shared home, OpenClaw state, and OpenClaw
credential encryption material. User files and provider authentication therefore
survive recreation. Packages installed with `sudo apt` modify only the current
container layer and disappear when the image is replaced; add durable operating
system tools to `workspace/Containerfile` instead.

Useful operator commands:

```bash
sudo bin/neural-labs workspace status
sudo bin/neural-labs workspace logs
sudo bin/neural-labs workspace shell
sudo bin/neural-labs workspace update
```

The workspace update command creates a complete backup, retains the previous
image under a timestamped rollback tag, rebuilds, recreates only the workspace,
and checks its loopback health endpoint. Version discovery is never automatic;
review a stable release, update the exact version and immutable digest together,
then invoke the command.

## Trust warning

Every approved user can influence the same agent and shared files. Commands can
obtain root inside the workspace through passwordless `sudo`, which means no
credential stored in this container is private from another approved user. Use
separate containers or virtual machines if users are not mutually trusted.
