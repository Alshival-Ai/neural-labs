# Set up your Neural Labs

Neural Labs gives you a self-hosted desktop with Neura, files, terminals, VS Code,
skills, and automations. You can use it on your own or invite trusted teammates
into the same workspace.

This quick setup takes you from a fresh checkout to your first Neura chat. If
someone already hosts your workspace, skip deployment and follow
[Your first workspace session](shared-workspace.md).

Prefer to have your agent handle installation? Start with
[Deploy with your agent](agent-onboarding.md). The repository's
[AGENTS.md](../AGENTS.md) tells it how to inspect your target, deploy the whole
instance, and guide you through account setup and verification.

## 1. Prepare your host

Use a Linux host with Docker Engine and the Compose plugin, Git, Bash, OpenSSL,
curl, and Node.js 22 or newer. You also need Nginx, a hostname pointing to the
host, and a valid TLS certificate for that hostname. The supported setup uses
HTTPS even for a personal instance; the deployment CLI requires a non-example
HTTPS origin.

The default workspace limit is **10 CPUs and 16 GiB RAM**, in addition to the
other services and image builds. Adjust the limits in `.env` for your host;
these defaults are not a tested minimum hardware requirement. Allow disk space
for images, persistent files, and backups.

The CPU limit must not exceed the host's available CPUs. For a Raspberry Pi,
read [Raspberry Pi deployment](raspberry-pi-deployment.md) before starting; it
covers 64-bit host preparation, smaller resource limits, and test cleanup.

Choose the final hostname now: sign-in callbacks and passkeys depend on it.
Only approve people you trust with the workspace's files and credentials. See
[Sharing and privacy](sharing-and-privacy.md) before inviting teammates.

## 2. Download and configure

Run these commands as the operator who owns the checkout and can access Docker:

```bash
git clone https://github.com/Alshival-Ai/neural-labs.git
cd neural-labs
bin/neural-labs init
```

Open the generated root `.env` in your editor. `init` generates the internal
secrets and protects the file with mode `0600`; keep those generated values.
Replace the public placeholders with your own values:

| Setting | What to enter |
|---|---|
| `NEURAL_LABS_HOSTNAME` | Your final hostname, without a scheme or path |
| `NEURAL_LABS_PUBLIC_ORIGIN` | `https://` followed by exactly that hostname, without a trailing slash |
| `NEURAL_LABS_INITIAL_ADMIN_EMAIL` | The email you will use to create your administrator account |
| `NEURAL_LABS_TURN_HOST` | The hostname clients use to reach this host's voice relay |
| `NEURAL_LABS_TURN_EXTERNAL_IP` | The host's public IPv4 address, or its router's public address when behind NAT |
| `NEURAL_LABS_TURN_RELAY_IP` | An IPv4 address actually assigned to the host's relay interface |
| `NEURAL_LABS_TURN_URLS` | Replace the example hostname in all three STUN/TURN URLs; keep their ports aligned with `NEURAL_LABS_TURN_PORT` |

The supplied Compose stack starts the TURN relay even if you do not use voice,
so its host/address values must be real. The [deployment guide](container-deployment.md#voice-relay-and-network-settings)
explains the network settings and the additional ports needed for Team Terminal
voice.

For your first personal deployment, keep these defaults:

```dotenv
NEURAL_LABS_BIND_ADDRESS=127.0.0.1
NEURAL_LABS_AUTO_SETUP=true
NEURAL_LABS_LOCAL_AUTH_ENABLED=true
NEURAL_LABS_MICROSOFT_AUTH_ENABLED=false
NEURAL_LABS_MCP_ENABLED=false
```

Microsoft sign-in, Google Maps, KLIPY, Pexels, SMS, and Neura voice are optional.
You can leave their credentials blank and connect them later. Neura text chat
uses a ChatGPT account connected after login; `OPENAI_API_KEY` is for audio.
Keep `.env` out of Git and save a protected backup of it.

## 3. Build and start

```bash
bin/neural-labs up
bin/neural-labs status
```

The first command builds the images, creates persistent volumes, runs database
migrations, and starts the stack. Status should show `postgres`, `landing`,
`control-plane`, `workspace`, and `turn` running. Give new services time to become
healthy. For a failing service, use `bin/neural-labs logs SERVICE`.

The application listeners are on host loopback. Next, make the desktop reachable
through authenticated HTTPS ingress.

## 4. Enable HTTPS

Copy the supplied Nginx configuration to an operator-owned file outside the
checkout, replace the project hostname and certificate settings with yours,
and enable it in your host's Nginx configuration. The complete, copyable steps
are in [Enable HTTPS ingress](container-deployment.md#enable-https-ingress),
including site activation and `nginx -t` before reload.

The CLI does not install Nginx, obtain certificates, change DNS, or open firewall
ports. Those are explicit host setup steps. Keep the supplied authentication
routes and loopback upstreams when adapting the configuration.

After enabling the site, replace the example hostname below and check:

```bash
curl --fail https://neural-labs.example.com/healthz
curl --fail https://neural-labs.example.com/api/auth/providers
```

Both should succeed. Opening `/workspace` in a signed-out browser should send
you to login. See [Troubleshooting](troubleshooting.md) for TLS, proxy, and
startup problems.

## 5. Create your account and connect Neura

1. Open `https://YOUR-HOSTNAME/signup` and register using the **exact email** you
   set in `NEURAL_LABS_INITIAL_ADMIN_EMAIL`. That account becomes the initial
   administrator. Other addresses wait for approval.
2. Open `/workspace`, then **Settings → Model Provider → OpenAI**.
3. Connect your ChatGPT account. Open the displayed sign-in URL, enter the
   one-time code, and keep Settings open until the connection is confirmed.
4. Open **Neura** from the dock, start a private conversation, and send a simple
   request, such as “Help me plan my first project.” A reply confirms that your
   personal agent can use its account.
5. Open **Files** or **VS Code** when you are ready to work with project files.

Your Neural Labs login and ChatGPT connection are separate. Connecting an
administrator's background account does not connect their personal Neura.
For scheduled AI work, also connect **Settings → Workspace → Background ChatGPT
connection**. See [AI accounts and models](ai-accounts.md) for personal,
background, Team Chat, and audio settings.

## 6. Check and protect your installation

```bash
bin/neural-labs doctor
bin/neural-labs backup
```

`doctor` checks local services and bindings and currently requires **all three**
optional Google Maps, KLIPY, and Pexels credentials. If you left those blank,
its provider-configuration failure is expected; inspect the other results
separately. It does not verify public TLS or a real model response.

Backup briefly stops the workspace and writes a recovery set outside the
checkout. Encrypt it and move a copy off-host. Follow [Backup and restore](backup-restore.md)
to plan retention and test recovery.

## Where to go next

- [Use your workspace](shared-workspace.md): Neura, files, terminals, skills, and collaboration.
- [Manage your instance](manage-instance.md): approve teammates, connect integrations, update, and recover.
- [Browse all guides](navigation.md): documentation organized by task.
- [Release history](release-history.md): changes and dated release records.
