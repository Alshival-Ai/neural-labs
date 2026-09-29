# Repository instructions

These instructions apply to the Neural Labs repository.

## Repository separation and GitHub synchronization

- This is the independently deployable, open-source Neural Labs product at
  `https://github.com/Alshival-Ai/neural-labs`. Keep default configuration and
  onboarding generic so users can deploy it on their own websites.
- Alshival.ai billing, Free/Go/Plus/Pro plan rules, portal navigation, customer
  provisioning policy, and portal-specific background-access policy belong in
  the separate website repository. Do not copy those business rules into base
  Neural Labs. Shared integration interfaces must remain optional and generic.
- After completing Neural Labs source changes, run the required validation,
  commit the completed changes, and push them to this repository's `main` branch
  before reporting the work finished. Fetch first and preserve concurrent work.
  A website-repository push does not update Neural Labs on GitHub.
- Keep credentials, customer data, private deployment configuration, and runtime
  state out of Git. Report the repository and pushed commit, plus any validation
  failures or blocked push; never imply unpushed changes are published.
- Pushing source does not deploy or upgrade existing installations. Follow the
  deployment/release runbooks separately when deployment is requested.

## Product and onboarding

Neural Labs is the complete self-hosted product in this repository. The public
project site leads visitors to GitHub; someone cloning it should be able to ask
their agent to deploy their own instance. That instance includes its own landing
page, signup/login, administration, and authenticated workspace on its chosen
HTTPS origin. Do not copy the maintainers' hostname, accounts, or deployment state.

The `landing` container serves `web/`; the separate `workspace` container runs
the desktop and developer runtime. The `control-plane` container serves accounts,
authorization, and the compiled `console/`. PostgreSQL stores control-plane data;
the supplied stack also includes TURN. Deploying only the landing container is
a site preview, not a complete Neural Labs installation. Landing customization
must preserve the routes into that instance's authentication and workspace.

## Agent-led deployment

When asked to install or deploy Neural Labs, carry the work through onboarding
and verification. Use [Agent-led onboarding](wiki/agent-onboarding.md) as the
workflow, [Quick setup](wiki/README.md) for the owner's journey, and
[Container deployment](wiki/container-deployment.md) for the actual commands.
Keep these guides synchronized when behavior changes.

1. **Establish the destination.** Reuse information already supplied. Resolve
   only missing choices: target host or hosting account, public/private access
   and final HTTPS hostname, initial administrator email, and persistent install
   versus disposable rehearsal. An existing SSH alias can identify the target.
   Inspect that target; never assume the agent's own machine is the destination.
2. **Discover before changing it.** Inspect OS, native CPU architecture, Docker
   access/context, CPU/RAM/disk, ports, subnets, ingress, and existing deployments.
   Confirm the Docker daemon belongs to the intended destination. Record
   the source revision and a baseline for changes and recovery. Preserve existing
   data, services, and private configuration. Identify a fresh installation versus
   an existing instance that needs the upgrade or recovery runbook. A deployment request authorizes
   routine setup on the identified target within the user's stated scope; do not
   ask for approval again at every step. Resolve new spending, destructive
   replacement, or access beyond that scope before proceeding.
3. **Select a supported path.** Start with native Linux Docker Compose and host
   Nginx. Check the actual image manifests and native executables for the target
   architecture, not just the host's Docker support. ARM64 manual deployment has
   a [Pi rehearsal](wiki/raspberry-pi-deployment.md). Build native amd64 and ARM64
   images and verify their actual provider protocols. Never silently force amd64
   emulation or claim that component checks establish the 8GB workload target.
   For another environment, assess the equivalent Linux host or a deployment
   adapter against the same auth, storage, and networking requirements first.
4. **Prepare and configure.** Install the documented host prerequisites using
   the target's package manager and authorized privilege method. Keep public
   source files readable (`umask 022` for a new clone). Run `bin/neural-labs init`
   with Docker access; protect `.env` as `0600` and preserve generated secrets.
   Set the user's origin, admin email, real TURN addresses, and resource limits
   appropriate to that host. Keep optional integrations optional. Use protected
   local configuration or the product's connection UI for credentials, not chat
   transcripts or public examples.
5. **Deploy the whole instance.** Run `bin/neural-labs up`, inspect status/logs,
   and wait for readiness. Configure DNS, certificates, and authenticated ingress
   following the guide. Keep application listeners on loopback and PostgreSQL
   private. The CLI does not install Nginx or configure DNS/TLS. On an existing
   managed installation, follow the updater runbook instead of bypassing its
   protected Compose descriptor.
6. **Complete the owner's onboarding.** Give the owner their exact signup or
   sign-in URL for the enabled authentication method and configured administrator
   email. Let them choose their password when using local login and finish
   interactive provider consent. Guide them to their personal AI connection and
   a first Neura request; background accounts are separate. Continue independent
   checks while waiting for owner-only steps, and report those steps as pending
   until completed. Do not require optional voice, SMS, Maps, KLIPY, or Pexels
   credentials for a basic text workspace.
7. **Verify outcomes and hand over.** Check HTTPS, all services, signed-out
   rejection, administrator access, Files/Terminal, and a real AI reply when the
   owner's account is connected. Account for documented doctor/readiness caveats
   without ignoring unrelated failures. Establish backup and recovery, then
   provide the instance URL, deployed revision/images, private configuration and
   backup locations (never values), lifecycle commands, supported update method,
   and explicit passed/pending checks. Container health alone is not completed
   onboarding or release approval.
8. **Honor the requested lifecycle.** Leave a persistent installation running.
   Remove a rehearsal only when cleanup was requested; remove only its resources
   and compare against the baseline. Never use volume deletion as a repair for
   an installation with user data.

## Safety

- Never commit tenant credentials, provider keys, SSH keys, certificates, VPN files, or generated tenant state.
- Treat `*.example` files as public. Use obvious placeholder values only.
- Do not mount the host container socket, `/home/data-team`, `/root`, or another tenant's state into a tenant container.
- Do not add `privileged: true`, host networking, host PID/IPC namespaces, or unrestricted host devices.
- Keep the shared skill mount read-only. Personal skills belong in the tenant home.
- Bind runtime ports to loopback and preserve authenticated workspace ingress.
- Pin deployable images by immutable digest when promoting beyond development.
- Host changes require an explicit operator step; repository validation must remain non-mutating.

## Quality

- Run `make validate` before committing.
- Keep shell scripts compatible with Bash and pass `bash -n`.
- Keep tenant examples generic and free of personal data.
- Update the architecture decision records when a trust boundary changes.

## Native runtime versioning

- The production runtime is Linux with native Codex app-server, Claude Code, and
  the Neural Labs service. Do not reintroduce a Gateway, OpenClaw executable,
  provider plugin, or recurring provider discovery dependency.
- `workspace/native/release.json` pins the Linux base, native provider versions,
  editor, and Supercronic binaries. Keep installer pins, protocol adapters,
  image identity, and native release checks synchronized. Codex and Claude in
  private Terminal use the same selected owner's credential home as Neura.
- Run `node bin/native-release.mjs check` and `make validate`. Test real native
  protocol initialization with isolated empty credential homes on each native
  architecture. Package metadata or a terminal version string alone is
  insufficient evidence of app-server/structured-stream compatibility.
- `workspace/update-release-policy.json` declares immutable automatic upgrade
  baselines. The first native migration remains operator-only until preservation
  and restoration have passed. Never add a baseline based on an image build alone.
- Read [Workspace updates](wiki/workspace-updates.md) and the
  [native security guide](deploy/security/README.md) before host changes. Keep
  original credentials, retained legacy volumes, and customer state separate.
  Historical OpenClaw documents describe old releases, not the current runtime.

## Update policy and deployment maintenance

- Settings → Updates is the administrator policy interface, backed by PostgreSQL.
  Preserve admin authorization, CSRF/same-origin checks, policy revisions, and
  audit history. Native executables are pinned to reviewed image releases.
- The host worker in `deploy/updater/` owns Docker operations. Keep credentials
  and protected deployment descriptors outside tenant containers. Automatic
  release discovery verifies repository/workflow/tag/commit provenance for
  both image and manifest. An operator publication does not establish automatic
  update eligibility; preserve that distinction and compatibility checks.
- Preserve maintenance gates, scheduler pause/resume, idle checks, and the second
  activity check before cutover. Manual installation bypasses the calendar window,
  not the idle requirement. Unknown activity must never count as idle.
- Before the durable commit decision, recover using the original release and
  state. After the decision or acceptance of new writes, retain candidate state
  and use forward recovery. Never restore an old database over customer writes.
  Keep unverifiable recovery gated and retain same-workspace recovery copies.
- Host security setup is an explicit operator operation. The separate native
  AppArmor profile and scoped Snap management rules must survive policy reloads;
  never disable AppArmor, add host capabilities, or expose the Docker socket to
  make provider processes work. Validation itself must not install host services.
- Source pushes, built images, and fixture success are separate from deployment.
  Report exact pushed commits, deployed digests, preservation results, measured
  performance, and any owner sign-ins or hardware checks still pending. Local
  recovery copies are not proof of NAS backup or restore verification.
