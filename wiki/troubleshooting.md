# Troubleshooting

Run operator commands from the repository root. Start with the failing service
or action; do not reset secrets or delete volumes to fix an unexplained error.

## The stack will not start

Run `bin/neural-labs status` and `bin/neural-labs logs SERVICE`, replacing
`SERVICE` with `postgres`, `landing`, `control-plane`, `workspace`, or `turn`.
A fresh build can take time; wait for health checks before testing login.

| Symptom | Check |
|---|---|
| `node is required` | Install Node.js 22 or newer on the operator host; the deployment CLI checks runtime pins before building |
| Cannot access Docker | Confirm Docker is running and use your operator privilege method; never give the workspace the host Docker socket |
| Configuration rejected | Set a real hostname and administrator email; the HTTPS origin must equal `https://` plus the hostname, with no trailing slash |
| `.env` permission error | Restore mode `0600` with `chmod 0600 .env` |
| `EACCES` reading workspace startup code, or TURN entrypoint `Permission denied` | Check whether a restrictive clone umask made public source files mode `0600`; use a checkout created with `umask 022` and rebuild, while retaining private `.env` permissions |
| Port already allocated | Check other listeners; if changing `.env` ports, update the corresponding Nginx upstreams |
| Docker subnet overlap | Choose an unused private `/29` and set `NEURAL_LABS_WORKSPACE_PROXY_IP` to its first usable address |
| TURN cannot bind | Replace the example relay address with an IPv4 address actually assigned to the host |
| `Official SMS plugin installation failed` on a fresh workspace | Check the npm-cache ownership issue below; startup installs the official plugin even when SMS is disabled |
| Build or process killed | Inspect host disk and memory availability, and the workspace resource limits |
| `Range of CPUs is from 0.01 to ...` | Reduce `NEURAL_LABS_WORKSPACE_CPUS` to the Docker host's available CPU count; the default of 10 exceeds a four-core Pi's capacity |

### Root-owned npm cache on first boot

The Raspberry Pi rehearsal found that the image's final root-run Claude install
could write into `/home/node/.npm` after the home ownership had been prepared.
The non-root startup process then failed to install the official SMS plugin.
The Containerfile now gives that build step its own temporary cache.

Rebuild from the corrected source. If an earlier image already initialized your
workspace volume, rebuilding alone preserves the old cache ownership. Stop the
workspace and repair only that cache through the instance's Compose definition:

```bash
sudo docker compose --env-file .env -f deploy/compose/compose.yaml stop workspace
sudo docker compose --env-file .env -f deploy/compose/compose.yaml \
  run --rm --no-deps --user 0:0 --entrypoint sh workspace \
  -c 'test ! -d /home/node/.npm || chown -R node:node /home/node/.npm'
sudo bin/neural-labs up
```

Do not delete persistent volumes to repair this on an existing installation.
Other plugin-install failures can be caused by registry access; inspect the
actual installation error before assuming an ownership problem.

## Doctor reports a provider failure

`bin/neural-labs doctor` requires Google Maps, KLIPY, and Pexels configuration,
even when you only want Files, Terminal, and personal Neura. Missing optional
keys produce a nonzero result. Inspect the service and loopback check results
separately rather than treating that result as a complete installation failure.

If you need those tools, an administrator can open **Settings → Plugins**, save
the relevant keys, and check each connection. Google Places and Geocoding need
their respective capabilities enabled for the same key. Allow the configuration
to apply before retrying. **Disconnect** overrides an environment key; use
**Use deployment configuration** to restore it.

A configured flag does not prove a successful paid provider request. Likewise,
a healthy TURN process does not prove browser-to-relay connectivity.

## HTTPS or login is unavailable

Verify DNS, certificate validity, and that the adapted site is included by Nginx.
Use `sudo nginx -t` before reloading; merely copying a file into
`sites-available` does not enable it. The supplied configuration uses
`http2 on;` and Let's Encrypt helper files: adapt these for your Nginx version
and certificate installation as described in the
[ingress guide](container-deployment.md#enable-https-ingress).

For a `502`, check the corresponding loopback service and port. A successful
`/healthz` checks the landing page only; check `/api/auth/providers` for the
control-plane route and use `doctor` for internal service checks.

If signup leaves you pending, confirm that you used the configured initial
administrator email. After the instance has an administrator, new users always
need approval in **Settings → Users**. Changing `.env` does not reassign an
existing administrator or overwrite saved authentication settings.

For Microsoft callback errors, compare the final origin with the registered
`/auth/microsoft/callback` URI. For passkeys, use the original HTTPS hostname
and ensure Microsoft is linked; see [Passkeys](passkeys.md).

## Neura will not answer

Open **Settings → Model Provider → OpenAI** and check your personal connection,
pause state, and model readiness. Use **Refresh connection** to recheck, Resume
if paused, or reconnect if the credential has expired. Connecting Background
ChatGPT or running `workspace codex-login` does not connect your personal Neura.

For Team Chat, check whether the administrator has activated a dedicated Team
account. Before activation, the message author's personal account is required;
after activation, the dedicated account is required. A manual automation run
uses the person pressing Run; a scheduled run uses its assigned agent.
See [AI accounts](ai-accounts.md).

If Neura stays disconnected while Files works, check the authenticated
`/workspace/neura/socket` proxy route and workspace logs. For administrator
scheduler controls, also check `/workspace/automations/socket`. Do not expose the
raw Gateway or bypass the proxy's authentication checks.

## Voice, SMS, or notifications do not work

- Neura realtime voice and memo transcription require the server audio API key
  and usable audio model settings. A ChatGPT text connection does not supply it.
- Team Terminal voice additionally needs browser microphone permission, HTTPS,
  and reachable TURN TCP/UDP and relay ports. Test from a second network after
  configuring NAT/firewall rules.
- SMS requires the administrator's Twilio connection and a verified phone.
  Proactive messages also require the member's notification opt-in.
- Automation notifications require both account channel permission and a
  subscription to that automation. Email also needs the administrator's sender
  configuration. Provider acceptance is not a delivery receipt.

## Changes or files seem missing

Saved files survive workspace recreation; running terminal processes and
interactively installed system packages do not. Browser layout is local to the
browser profile. Closing an app is different from deleting its data.

Look in Files' shared Trash for deleted or replaced files. For lost state outside
Trash, follow [Backup and restore](backup-restore.md). Before an update, read the
release notes and retain the complete recovery set; a previous image alone may
not undo a database or credential-store migration.
