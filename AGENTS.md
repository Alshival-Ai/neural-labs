# Repository instructions

These instructions apply to the Neural Labs repository.

## Safety

- Never commit tenant credentials, provider keys, SSH keys, certificates, VPN files, or generated tenant state.
- Treat `*.example` files as public. Use obvious placeholder values only.
- Do not mount the host container socket, `/home/data-team`, `/root`, or another tenant's state into a tenant container.
- Do not add `privileged: true`, host networking, host PID/IPC namespaces, or unrestricted host devices.
- Keep the shared skill mount read-only. Personal skills belong in the tenant home.
- Bind Gateway ports to loopback until an authenticated ingress design is reviewed.
- Pin deployable images by immutable digest when promoting beyond development.
- Host changes require an explicit operator step; repository validation must remain non-mutating.

## Quality

- Run `make validate` before committing.
- Keep shell scripts compatible with Bash and pass `bash -n`.
- Keep tenant examples generic and free of personal data.
- Update the architecture decision records when a trust boundary changes.

## Runtime versioning

- Read [OpenClaw upgrades](wiki/openclaw-upgrades.md) for release preparation and [Workspace updates](wiki/workspace-updates.md) for managed deployment, publication, and recovery. These are the maintenance runbooks; keep them current when behavior changes.
- `workspace/openclaw-release.json` is the reviewed source of truth for the upstream image digest/source revision, matching OpenClaw integration packages, terminal Codex fallback, and separate Codex app-server pin. Read current versions there rather than copying historical versions from notes or this file.
- Keep upstream OpenClaw's `/app` unchanged and `patches: []`. Customizations belong in Neural Labs code and supported public configuration, plugins, skills, or MCP tools. Do not edit compiled bundles, import hashed internal modules, or run `openclaw update` inside a deployed workspace.
- For a release change, verify upstream provenance and intervening migration notes, edit the manifest, run `node bin/openclaw-release.mjs sync`, regenerate both workspace and desktop npm lockfiles, then run `node bin/openclaw-release.mjs check` and `make validate`. Sync does not edit private `.env` overrides, lockfiles, or running services. Use an isolated checkout when unrelated work is present; preserve historical release notes.
- `workspace/update-release-policy.json` declares the exact migration baselines supported by a reviewed release. Add support only after migration and restoration pass for that baseline. Record release evidence under `wiki/upgrades/`.

## Codex and the custom app-server integration

- Maintain three distinct components: upstream OpenClaw, the terminal Codex CLI, and the Codex app-server used by OpenClaw. A terminal CLI upgrade does not establish app-server compatibility.
- Preserve our custom app-server workaround: install a separately pinned official Codex package outside `/app` and select it through `plugins.entries.codex.config.appServer.command`. The reviewed image owns that installation under `/usr/local/lib/neural-labs/codex-app-server`; older deployments may still use a persistent-home override. Inspect the actual deployment before migrating it.
- Recheck the upstream Codex plugin's expected app-server version on every OpenClaw upgrade. Do not replace this command with the auto-updated terminal launcher or remove the workaround merely because the terminal CLI works. Verify the real executable and public app-server initialization/thread-list protocol with an isolated account directory; package metadata alone is insufficient.
- Terminal auto-updates use the official stable npm package, isolated installation directories, disabled lifecycle scripts, version verification, and atomic selection for new launches. Preserve the image fallback and prior installations. Disabling updates stops checks and retains the selected version; it does not downgrade it.

## Update policy and deployment maintenance

- Settings → Updates is the administrator policy interface, backed by PostgreSQL. `NEURAL_LABS_CODEX_AUTO_UPDATE` supplies the initial default only. Keep OpenClaw automatic installation opt-in and its native auto-updater disabled. Preserve admin authorization, CSRF/same-origin checks, policy revisions, and audit records.
- OpenClaw automation consumes reviewed Neural Labs workspace releases, not arbitrary upstream tags. `.github/workflows/workspace-release.yml` publishes immutable images and attested manifests through the reviewed `workspace-releases` environment. Keep repository/workflow/tag/commit verification and host/control-plane compatibility checks intact; incompatible changes require an operator upgrade.
- Before promotion, build the candidate, compare `/app` against its exact upstream image, and run native migration/restore, quiet-mode, app-server, and Docker deployment/rollback rehearsals on isolated synthetic state. Use an isolated database for integration tests. These container-based checks are explicit operator/CI steps, separate from non-mutating `make validate`; never use production volumes or credentials as test fixtures.
- The host worker in `deploy/updater/` owns Docker operations. Keep host credentials and deployment descriptors outside tenant containers. Follow the runbook for explicit preparation/activation, including Snap Docker paths. Source changes, successful tests, and built images do not imply that host services are installed, enabled, or deployed; verify and report those states separately.
- Preserve maintenance gates, scheduler pause/resume, idle checks, and the second activity check before cutover. Manual installation bypasses the schedule, not the idle requirement. Missing activity information must not count as idle.
- Before the durable commit decision, recover with the prior immutable image and original volumes. After commit, retain the selected candidate state; never automatically rewind newly accepted writes or restore the control-plane database. Keep unverifiable recovery gated, retain recovery data, and follow the runbook before reopening access or pruning backups.
- Once the managed updater is active, do not bypass its protected deployment descriptor with legacy Compose mutations. Host/control-plane upgrades and recovery require the coordinated operator procedure. Update [ADR 0035](wiki/adr/0035-terminal-codex-automatic-updates.md) and [ADR 0036](wiki/adr/0036-reviewed-workspace-updates.md) when changing these contracts.
