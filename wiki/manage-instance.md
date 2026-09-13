# Manage your instance

Open **Settings** from the desktop dock. Every member can manage their own
account; administrators also see Users, Authentication, Workspace, and Audit
log. The [Settings guide](desktop-settings.md) describes each area.

## Invite and approve teammates

Give a teammate your instance's `/signup` URL, or `/login` if you use
Microsoft-only sign-in. Their account remains pending until an administrator
approves it in **Settings → Users**. Approve only mutually trusted collaborators:
all active users work in the same container and filesystem.

Use Users to disable access or change a role. Disabling an account invalidates
its sessions. You cannot disable or demote the last active administrator.
Each member connects their own AI account through
[Model Provider](ai-accounts.md) and manages sign-in methods in
**Settings → Security**.

## Connect optional services

| Capability | Where to configure it | Guide |
|---|---|---|
| Background AI, dedicated Team Neura, audio defaults | Settings → Workspace | [AI accounts](ai-accounts.md) |
| Microsoft login | Entra app registration, then Settings → Authentication or initial `.env` | [Microsoft sign-in](entra-app-setup.md) |
| Google Maps, KLIPY, Pexels | Settings → Plugins → provider card | [Provider tools](workspace-provider-mcp.md) |
| Twilio SMS/MMS | Settings → Plugins → Twilio SMS/MMS | [Settings](desktop-settings.md#plugins-and-sms) |
| Personal notification consent | Settings → Personalization, then each automation's Subscribe action | [Automations](automations.md#subscriptions) |
| Passkeys | Settings → Security after linking Microsoft | [Passkeys](passkeys.md) |

Plugin connection checks may consume provider quota. Saved provider keys override
`.env`; Disconnect disables a provider even when an environment key exists.
Choose **Use deployment configuration** to restore that fallback deliberately.

## Check service health

Run from the repository root using your operator account:

```bash
bin/neural-labs status
bin/neural-labs doctor
bin/neural-labs logs workspace
```

Logs follow until Ctrl+C; that does not stop the service. `doctor` expects the
three optional provider keys and may fail their check on a basic deployment.
It also does not prove public HTTPS, actual TURN connectivity, or model access.
Use the [troubleshooting guide](troubleshooting.md) to distinguish those checks.

## Update an instance

Read the [changelog](../CHANGELOG.md) and relevant [release record](release-history.md),
review the target source revision, and obtain that revision in your deployment
checkout using your normal Git workflow. `bin/neural-labs update` builds the
**current checkout**; it does not fetch new code.

```bash
bin/neural-labs update
```

The command builds candidates, takes a backup, replaces services, and runs
health checks. Expect a workspace interruption: terminal processes end on
container recreation. Home-directory files, skills, credentials, and editor
settings persist. Packages installed interactively into the container's system
layer do not persist.

If the release changes Nginx routes, apply the reviewed
[host configuration](container-deployment.md#enable-https-ingress) explicitly.
The CLI does not install it. For an OpenClaw version change or a workspace-only
update, follow [Runtime upgrades](openclaw-upgrades.md); do not change a tag
without its reviewed digest and compatible package pins.

## Back up, recover, and stop

Use [Backup and restore](backup-restore.md) for complete recovery sets, off-host
copies, retention, and restore verification. Trash in Files is useful for
accidental deletion but does not replace a backup.

```bash
bin/neural-labs backup
bin/neural-labs stop
```

`stop` preserves volumes and configuration. Use `bin/neural-labs up` to start
again. The workspace must remain running for scheduled work to execute.
