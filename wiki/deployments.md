# Deploy websites and apps

Neural Labs includes the **deploy** skill for Codex and Claude. Ask:

> Create a website that says “Hello, World!” and $deploy.

Alshival checks hosting, prepares a project release, starts it, and returns its
URL. Without a configured public domain the first URL is normally
`http://127.0.0.1:31000/`. With `*.apps.example.com` configured, it is
`https://website1.apps.example.com/`. Request a name to choose another DNS label.
An explicit deployment request authorizes publication; generating files alone
does not publish them.

## Manage deployments

Open **Deployments** from the desktop dock to see URLs, status, hosting readiness,
logs, and build/runtime details. Start, restart, stop, or remove an app there, or
ask Alshival using `$deploy`. Removal unpublishes the app and preserves source
files and application data. Reusing its name reuses its retained data. The slots
are shared by workspace members; they are not private member deployments.

Apps continue after chat ends. Running apps restart with Neural Labs; stopped
apps stay stopped. Builds and readiness checks finish before traffic switches.
A failed update keeps the previous release serving. At most three automatic
crash restarts are attempted; inspect logs and restart manually after correcting
the cause. Maintenance closes app ingress and stops app processes; committed
activation restores desired running apps. A runtime restart interrupts existing
connections. This is workspace hosting, not a separate high-availability platform.

Public apps bypass workspace member login. Add authentication to your app if its
visitors need it. The Portal's credentials and provider accounts are never
inherited. The current ingress strips Authorization headers; use app-owned,
host-scoped cookies for visitor sessions. Apps cannot receive workspace API
credentials merely because they were published.

## Supported projects

- Static HTML/CSS/JavaScript or built static sites. Select only the public output
  folder, such as `dist`, rather than a source directory containing private files.
- Node or Python HTTP apps. Provide build and production start commands, listen
  on `127.0.0.1:$PORT`, and return a successful HTTP response at `/` for readiness.
- Use `$DATA_DIR` for retained writable data. Serving code is read-only. Python
  apps can create a project `.venv` during their build and run its interpreter.
- Snapshots omit `.env*`, `.git`, credential folders, `node_modules`, and `.venv`.
  Reinstall dependencies during the build. Do not place private documents or
  hard-coded credentials in public output. No environment-secret editor, Docker
  deployment, managed database provisioning, or automatic data rollback is provided.

Builds have a five-minute limit; readiness has a 30-second limit. Native CLI
tool requests allow seven minutes for build and verification, while execution
leases continue to be checked. Claude automatic MCP backgrounding is disabled
so ending a turn cannot silently detach an unfinished deployment. These use the
[Codex MCP timeout setting](https://learn.chatgpt.com/docs/config-file/config-reference)
and [Claude MCP environment settings](https://code.claude.com/docs/en/env-vars). Snapshots allow
up to 20,000 files and 512 MiB before dependencies are installed. Logs retain a
bounded recent tail. Build commands and server processes share the workspace's
configured CPU, memory, and storage allowance. The app sandbox mounts only its
release and dedicated home, without other projects or model-account homes.
Workspace operators retain their existing administrative access.

## Local hosting: no DNS required

The default Compose configuration publishes ten app gateway ports **only on host
loopback**. No TLS certificate is needed. Keep these settings aligned:

```dotenv
NEURAL_LABS_APP_DOMAIN=
NEURAL_LABS_APP_PUBLIC_READY=false
NEURAL_LABS_APP_SLOTS=10
NEURAL_LABS_APP_LOCAL_PORT=31000
NEURAL_LABS_APP_LOCAL_PORTS=31000-31009
```

For twenty slots starting at 32000, use slots `20`, local port `32000`, and range
`32000-32019`. If another installation uses these ports, choose a free range.
Change configuration before starting the stack or through the installation's
supported upgrade procedure; changing `.env` alone does not update containers.
The service rejects invalid slot counts (1–100) and port ranges.

`127.0.0.1` means the **installation's machine**, not a remote user's laptop. For
a remote installation, a user with authorized SSH access can forward an app:

```bash
ssh -N -L 31000:127.0.0.1:31000 your-server
```

Then open `http://127.0.0.1:31000/` on that laptop. Keep the same local port
in the tunnel because the gateway validates the Host header. Local apps share
the loopback hostname; separate ports do not isolate cookies. Never expose the desktop/control
listener publicly as a shortcut for publishing an app.

## Configure public hosting before deploying apps

1. Choose a separate app namespace, such as `*.apps.example.com`. Do not reuse
   your workspace login origin. Create a wildcard A record pointing to public
   ingress, and AAAA only if IPv6 routing works. A wildcard CNAME to the ingress
   hostname is also suitable where your DNS provider supports it.
2. Obtain a certificate covering **`*.apps.example.com`** at the ingress host.
   The certificate for `*.example.com` does not cover these app hosts. Use your
   DNS provider's supported ACME DNS-01 integration with narrowly scoped,
   operator-protected credentials, or delegate the challenge zone.
3. Configure automated renewal and a successful-renewal hook that checks and
   reloads Nginx. Run `certbot renew --dry-run`. Manual DNS entry without renewal
   hooks does not provide unattended renewal. See the official
   [Let's Encrypt challenge guide](https://letsencrypt.org/docs/challenge-types/#dns-01-challenge)
   and [Certbot renewal documentation](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates).
4. Adapt [the standalone app ingress template](../deploy/nginx/apps.example.conf)
   to your hostname, certificate paths, and loopback desktop port. Install it as
   an operator-owned Nginx configuration. Run `nginx -t` before reloading. Open
   public ports 80/443 as appropriate; keep application/control ports private.
5. Configure the workspace container:

   ```dotenv
   NEURAL_LABS_APP_DOMAIN=*.apps.example.com
   NEURAL_LABS_APP_PUBLIC_READY=true
   ```

   The domain setting accepts a wildcard hostname or its base hostname, not a
   URL with a path, protocol, or port. The skill discovers this setting; do not
   edit `SKILL.md`. The ready flag is an **operator attestation**, not automatic
   DNS provisioning. Set it only after checking DNS, TLS, ingress and renewal.
6. Recreate through your supported install/update workflow. Verify that an
   unregistered name returns 404 with the `X-Neural-Labs-App-Gateway: ready`
   header over valid HTTPS. Deploy a harmless first app and verify its real URL,
   static assets, and any WebSocket connection.

The agent checks the public URL after publication and reports verification
failures separately from process readiness. A configured public domain that is
not ready never silently becomes a local deployment.

## Managed hosting and custom domains

On managed installations, the hosting integration supplies the generated
workspace domain and current readiness. A workspace manager enables **Public web
access** in Workspace Settings → Services after operator verification. The
Portal manages generated DNS, certificates, and renewal. No DNS/API key belongs
in the skill or app container.

For a custom namespace such as `*.apps.customer.com`:

1. Request custom-domain registration from the hosting operator. The operator
   supplies a workspace-specific TXT ownership challenge and the public ingress
   destination. Point the wildcard to **that ingress**, not a private runtime IP.
2. Publish the ownership TXT and wildcard routing record. The hosting operator
   configures the matching wildcard certificate and automated DNS-01 renewal.
   A delegated `_acme-challenge` record can support renewal without handing over
   broad DNS account access; provider/plugin support must be checked.
3. The operator verifies ownership, HTTPS and routing, then registers the domain
   to your workspace. It becomes the selected app namespace and appears in
   Services and Deployments. App names are retained; generated-domain app URLs
   stop routing when the custom namespace replaces them.
4. Deploy or update an app and check the new URL. Existing apps keep running;
   applications with explicit allowed-host/origin or callback settings may need
   configuration updates.

**DNS alone is insufficient.** The gateway must register your namespace, and TLS
must cover it. Custom-domain onboarding is operator-assisted in this version;
there is no self-service domain wizard. Certificate renewal remains the hosting
operator's responsibility.

## Troubleshooting

- **Hosting unavailable:** check the configured namespace and managed Public web
  access switch. A runtime-generation change requires managed route verification.
- **App running, URL unverified:** inspect DNS, TLS, ingress and app readiness;
  being alive inside a container does not prove public reachability.
- **Failed build/start:** open Logs. Confirm dependencies are installed into the
  release and the server uses `$PORT`, loopback and `$DATA_DIR`.
- **Local link fails remotely:** use a tunnel or configure public hosting.
- **Capacity exhausted:** remove unused deployments or have the operator adjust
  slots, mapped ports and workspace resource capacity together.
