# Deploy your Neural Labs instance

The supported deployment is Docker Compose behind an existing host Nginx. The
four HTTP ports bind to loopback by default; PostgreSQL has no host port. The
workspace desktop and its status endpoint share one loopback listener. Team
Terminal voice also runs a coturn service on the host network because TURN is
not HTTP traffic and cannot traverse the Nginx reverse proxy.
The provider MCP is a child process inside the workspace container and has no
host or Compose-network listener.

Start with the [quick setup](README.md) for the complete personal-installation
sequence. This page provides the detailed host and ingress steps.

## Prerequisites

- a Linux host with Docker Engine and the Compose plugin;
- Git, Bash, OpenSSL, curl, and Node.js 22 or newer on the operator host;
- Nginx, working DNS, and a valid certificate for the final HTTPS hostname;
- a repository checkout owned by the operator, not by a service container;
- enough CPU, memory, and storage for builds, persistent data, and backups.
  The workspace defaults to limits of 10 CPUs and 16 GiB; these are configurable
  ceilings, not a measured minimum for a small personal installation.

Set `NEURAL_LABS_WORKSPACE_CPUS` no higher than the Docker host's available CPUs
before the first build. Docker rejects a CPU limit above the host's capacity.
Leave memory for the operating system, PostgreSQL, the control plane, and builds;
do not allocate all host RAM to the workspace. Use `nproc`, `free -h`, and
`df -h /` to inspect a new host. See [Raspberry Pi deployment](raspberry-pi-deployment.md)
for the ARM64 rehearsal, host preparation, and cleanup procedure.

The CLI uses Docker during `init` and Node.js during `up` and updates. Check
`docker compose version`, `docker info`, and `node --version` before starting.
Installing these prerequisites and obtaining a certificate are operator steps.

If Docker requires root, use `sudo bin/neural-labs init`,
`sudo bin/neural-labs up`, and the same prefix for subsequent Docker commands.
Use `sudoedit .env` when root created the private configuration. If Node is
installed through an operator's version manager, preserve its executable path
with `sudo env "PATH=$PATH" bin/neural-labs up`. Do not run the entire Git
checkout as root or make the Docker socket world-writable.

No service mounts the Docker socket or a host home directory.

## Voice relay and network settings

The supplied stack always starts TURN. Set `NEURAL_LABS_TURN_HOST`,
`NEURAL_LABS_TURN_EXTERNAL_IP`, `NEURAL_LABS_TURN_RELAY_IP`, and
`NEURAL_LABS_TURN_URLS` in `.env` before starting, even when initially testing
only text chat. The relay IP must be an IPv4 address on the host; the example
addresses cannot bind on your machine. On a directly addressed host, external
and relay IPs may be the same. Behind NAT, use the host's interface address as
the relay IP and the router's public address as the external IP.

The current Compose file runs the separate coturn service with host networking;
application containers, including the workspace, remain on Docker bridges.
This existing relay configuration is distinct from the workspace's isolation.

Team Terminal voice additionally requires the configured TURN listener port
over TCP and UDP plus the configured narrow UDP relay range. If the host is
behind NAT, forward those ports to `NEURAL_LABS_TURN_RELAY_IP`. Set
`NEURAL_LABS_TURN_EXTERNAL_IP` to the public address for
`NEURAL_LABS_TURN_HOST`. With the defaults, that means port **3478 TCP and UDP** and **49160–49200 UDP**.
Keep the relay range narrow and match all STUN/TURN URLs to your configured
host and port. Opening these ports is needed for remote Team Terminal voice;
it is not required for a first text chat.

The control plane gives authenticated voice
participants one-hour credentials derived from `NEURAL_LABS_TURN_SECRET`; the
shared secret reaches neither browsers nor the developer-accessible workspace.

## Configure public values and secrets

```bash
bin/neural-labs init
```

The command copies the public example only when the root `.env` does not exist,
migrates the former multi-file layout when detected, and generates only missing
secret values. Edit this one file with the final HTTPS origin, hostname,
intended initial administrator email, authentication switches, and optional
Entra values. It is ignored by Git and must remain mode `0600`.

Back up `.env` securely before continuing. Losing its control-plane master key
makes an Entra credential stored in PostgreSQL undecryptable.

## Build and start on loopback

```bash
bin/neural-labs up
bin/neural-labs status
```

The containers use `restart: unless-stopped`, so Docker's systemd service starts
them again after a reboot. Validate the private listeners:

```bash
bin/neural-labs doctor
```

The doctor checks the workspace-local MCP through the container and requires
the TURN service to be healthy. All three optional provider credentials (Google Maps, KLIPY, and Pexels) must
be configured for its MCP check to pass. A basic personal deployment can use
Neura text chat, Files, and Terminal without those keys; inspect the other
checks separately. Doctor checks that TURN is running, not end-to-end voice.
See [Troubleshooting](troubleshooting.md#doctor-reports-a-provider-failure).

## Enable HTTPS ingress

The supplied [Nginx configuration](../deploy/nginx/neural-labs.ai.conf) contains
the authentication checks and routes the desktop needs. Make an operator-owned
copy outside the checkout so your hostname and certificate changes stay local:

```bash
install -m 0600 deploy/nginx/neural-labs.ai.conf ../neural-labs.nginx.conf
```

Edit that copy before installing it:

1. Replace every `neural-labs.ai` hostname, including redirects and certificate
   paths, with your final hostname.
2. The template includes a `www` redirect server. Either provide DNS and a
   certificate covering that alias or remove the alias from the HTTP server
   and remove its separate HTTPS redirect server.
3. Set the certificate/key paths and TLS helper files for your certificate
   installation. The template's `/etc/letsencrypt/options-ssl-nginx.conf` and
   `ssl-dhparams.pem` must exist if retained. It uses `http2 on;`; adapt that
   directive to your installed Nginx version if configuration validation rejects it.
4. If you changed the application ports in `.env`, update the matching loopback
   upstreams. Keep the session subrequests, identity-header replacement,
   WebSocket handling, upload limits, and disabled public MCP routes intact.

For a host whose Nginx includes `/etc/nginx/sites-enabled/*`, install and enable
the site explicitly:

```bash
sudo install -o root -g root -m 0644 ../neural-labs.nginx.conf \
  /etc/nginx/sites-available/neural-labs.conf
sudo ln -s /etc/nginx/sites-available/neural-labs.conf \
  /etc/nginx/sites-enabled/neural-labs.conf
sudo nginx -t
sudo systemctl reload nginx
```

Create the symlink only on first installation; if it already exists, verify
that it points to the intended file. On hosts that use `conf.d` instead, install
the site in the directory included by that host's `http` configuration. Keep
only one active copy of these named upstreams and server blocks. Reload only
after `nginx -t` succeeds. The CLI does not perform any of these host changes.
Verify an actual HTTPS request after reload and inspect the Nginx error log if
the expected listener is absent. A successful reload command only confirms
that the signal was sent. When changing a wildcard listener to loopback for a
private rehearsal, a full Nginx restart may be needed to release the old socket;
plan that interruption if Nginx serves other sites.

The routing is:

| Public path | Loopback service |
|---|---|
| `/` and landing assets | landing `127.0.0.1:4173` |
| login, setup, account, admin, `/api/`, `/auth/` | control plane `127.0.0.1:4174` |
| `/mcp`, `/oauth/`, OAuth well-known metadata | Explicit `404`; public MCP is disabled in V1 |
| `/workspace`, its assets, `/workspace/api/files*`, and ticketed `/workspace/api/neura/media/outgoing/*` | Authenticated workspace desktop, confined file API, and fixed-origin Neura media relay `127.0.0.1:4181` |
| `/workspace/neura/socket` | Authenticated Neura-to-OpenClaw WebSocket `127.0.0.1:4180` |

The React console is compiled into the control-plane image and served below
`/control-assets/console/`. It has no listener, container, or host port of its
own, so adding console pages does not require another Nginx upstream.

If replacing the earlier standalone service on an existing host, stop and
disable it only after the landing container is healthy:

```bash
sudo systemctl disable --now neural-labs-web.service
```

Do not expose a container port on `0.0.0.0`; change the bind address only after
an authenticated ingress review.

## Claim the configured administrator

No SSH tunnel or host-specific alias is required. With local login enabled,
open `https://<hostname>/signup` and register the exact email configured as
`NEURAL_LABS_INITIAL_ADMIN_EMAIL`. With Microsoft-only login, open
`https://<hostname>/login` and sign in with that email.

Only the configured address can become the first active administrator. Any
other identities remain pending, so public ingress does not create a
first-visitor race.
Approved regular users are redirected to `/workspace`; administrators can open
the same environment from the console.

## Verify the public deployment

```bash
curl --fail https://neural-labs.example.com/healthz
curl --fail https://neural-labs.example.com/api/auth/providers
test "$(curl -sS -o /dev/null -w '%{http_code}' https://neural-labs.example.com/mcp)" = 404
test "$(curl -sS -o /dev/null -w '%{http_code}' https://neural-labs.example.com/.well-known/oauth-protected-resource/mcp)" = 404
```

The MCP and OAuth paths return `404`. Provider tools are reachable only
by the shared OpenClaw runtime over workspace loopback.
An unauthenticated request to `/workspace` must redirect to login, and an
unauthenticated WebSocket handshake at `/workspace/neura/socket` must not reach
the Gateway. The retired `/workspace/openclaw/` browser UI returns `404`.
File uploads use the authenticated `/workspace/api/files/upload` path, stream
through Nginx without request buffering, and accept at most 2 GiB per file by
default. The internal authentication subrequest locations repeat the same body
ceiling even though they discard request bodies; Nginx otherwise applies its
smaller default while entering the auth subrequest and converts a large upload
into an authentication error. Keep `NEURAL_LABS_WORKSPACE_MAX_UPLOAD_BYTES` at
or below the reviewed Nginx `client_max_body_size` value.
The authenticated `/workspace/api/files/events` response is a long-lived SSE
stream used for multi-user file invalidation. The supplied Nginx workspace
location already disables response buffering and has a one-hour read timeout,
so it does not require another public route or a WebSocket upgrade block.
Generated Neura attachment URLs must first be authorized through the user's
Neura WebSocket and resolved to a short-lived OpenClaw media ticket. The
workspace media route accepts only that ticketed outgoing-media path and relays
it to the container's loopback Gateway; it must not be expanded into a generic
Gateway proxy.

Open `/workspace` and connect your own ChatGPT account under **Settings → Model
Provider → OpenAI**. Send a private Neura request to verify model access. If you
want scheduled AI work, also connect the Background ChatGPT account under
**Settings → Workspace**. These connections are independent; see
[AI accounts and models](ai-accounts.md).

## Updating

First obtain and review the source revision you intend to deploy. The CLI does
not fetch Git updates. Then build, back up, replace containers, and verify
health with:

```bash
bin/neural-labs update
```

Database migrations are forward-only and run when the control plane starts.
The CLI never installs Nginx, invokes `sudo`, deletes volumes, regenerates an
existing secret, or removes old backups. Raw Compose commands remain available
for troubleshooting, but normal operators should use the lifecycle CLI.
