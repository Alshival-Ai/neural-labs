# Container deployment and onboarding

The supported deployment is Docker Compose behind an existing host Nginx. The
five HTTP ports bind to loopback by default; PostgreSQL has no host port. The
workspace desktop and its status endpoint share one loopback listener.

## Prerequisites

- Docker Engine with the Compose plugin;
- OpenSSL;
- Nginx and a valid certificate for the final hostname;
- a repository checkout owned by the operator, not by a service container.

No service mounts the Docker socket or a host home directory.

## 1. Configure public values and secrets

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

## 2. Build and start on loopback

```bash
bin/neural-labs up
bin/neural-labs status
```

The containers use `restart: unless-stopped`, so Docker's systemd service starts
them again after a reboot. Validate the private listeners:

```bash
bin/neural-labs doctor
```

An MCP health response of `unconfigured` is healthy during onboarding.

## 3. Enable same-domain ingress

Review `deploy/nginx/neural-labs.ai.conf`, replace the example hostname and
certificate paths when self-deploying, then install it as an explicit host
operation:

```bash
sudo install -o root -g root -m 0644 deploy/nginx/neural-labs.ai.conf \
  /etc/nginx/sites-available/neural-labs.ai.conf
sudo nginx -t
sudo systemctl reload nginx
```

The routing is:

| Public path | Loopback service |
|---|---|
| `/` and landing assets | landing `127.0.0.1:4173` |
| login, setup, account, admin, `/api/`, `/auth/` | control plane `127.0.0.1:4174` |
| `/mcp`, `/oauth/`, OAuth well-known metadata | MCP `127.0.0.1:3000` |
| `/workspace`, its assets, and `/workspace/api/files*` | Authenticated workspace desktop and confined file API `127.0.0.1:4181` |
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

## 4. Claim the configured administrator

No SSH tunnel or host-specific alias is required. With local login enabled,
open `https://<hostname>/signup` and register the exact email configured as
`NEURAL_LABS_INITIAL_ADMIN_EMAIL`. With Microsoft-only login, open
`https://<hostname>/login` and sign in with that email.

Only the configured address can become the first active administrator. Any
other identities remain pending, so public ingress does not create a
first-visitor race.
Approved regular users are redirected to `/workspace`; administrators can open
the same environment from the console.

## 5. Verify the public deployment

```bash
curl --fail https://neural-labs.example.com/healthz
curl --fail https://neural-labs.example.com/api/auth/providers
curl --fail https://neural-labs.example.com/.well-known/oauth-protected-resource/mcp
```

The metadata request returns `503` until Microsoft MCP access is enabled, and
an unauthenticated configured MCP request must return `401`, never tool data.
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

As the initial administrator, open `/workspace`, launch **Settings** from the
dock, choose **Workspace**, and connect the shared OpenClaw runtime to a
ChatGPT/Codex account. The
[shared workspace guide](shared-workspace.md) includes the UI flow and operator
recovery command.

## Updating

Create a backup, rebuild, replace containers, and verify health with:

```bash
bin/neural-labs update
```

Database migrations are forward-only and run when the control plane starts.
The CLI never installs Nginx, invokes `sudo`, deletes volumes, regenerates an
existing secret, or removes old backups. Raw Compose commands remain available
for troubleshooting, but normal operators should use the lifecycle CLI.
