# Unmodified OpenClaw build verification

Reviewed on 2026-09-06. The initial checks below cover the refactor on 2026.8.2.
The subsequent operator deployment is recorded at the end; 2026.9.2 is not promoted.

The candidate removes the pending planning source build/patch and compiled
overlay. It also removes both overrides of OpenClaw's managed Codex launchers.
Neural Labs features remain in its own application layers and use ordinary
Gateway requests and the public configuration CLI. See
[ADR 0028](../adr/0028-upstream-openclaw-boundary.md) for the behavior tradeoff.

## Image evidence

- Base: `ghcr.io/openclaw/openclaw:2026.8.2@sha256:5d25165995041caa6a7175bec82b25ad98c44eb269bb42435da8e27ec06e6be4`.
- Candidate local image: `sha256:d52d89072b2ec01849408ffc9e791cfed8ef9e2c61fb88cba800932cbd89423e`.
- Candidate development tag: `neural-labs-workspace:upstream-boundary-20260906`.
- Build completed, including desktop compilation, MCP validation and installed
  OpenClaw version/revision verification.
- `bin/openclaw-compare-image` found all **65,841** `/app` entries identical in
  both images, including content, symlink targets, permissions and ownership.
  Tree fingerprint: `fc8a3aa2658970814c7cd067f28d4211b3d8c6fe9fce3917e9a4279297f277a1`.
- `bin/openclaw-smoke-test` passed on the candidate: synthetic config dry run,
  atomic write, invalid-batch rejection and unrelated-setting preservation.

The comparison and smoke test used temporary containers with read-only roots,
no network and no tenant mounts. The candidate is a development build of the
working tree, which also contains independent application work. Its local ID is
evidence of this comparison, not a production promotion record.

## Application checks

The planning tests cover ordinary-message drafting, durable plan reconstruction,
pending and superseded plans, duplicate implementation clicks, unsent draft
preservation, completion before acknowledgement, and the published unmodified
`chat.send` schema. Release tests reject source patches and explicit `/app`
overlays. Tree-comparison tests detect changed code, launcher targets, extra
entries and permission changes.

The full repository `make validate` passed, including version pins, package locks,
application tests/builds and mocked deployment ordering/recovery. Database and
browser integration suites that require separate opt-in environments are not
promotion evidence from this command alone.

## Remaining release work

The [2026.9.2 assessment](openclaw-2026.9.2.md) still requires candidate account
ownership, agent-tool isolation and migration/restore tests. The source-patch
rebase is eliminated. Draft plan is advisory and does not provide native Plan
mode enforcement; existing tool permissions remain unchanged.

## Operator deployment

On 2026-09-06 the operator authorized rebuilding and deploying. The workspace
and control plane were rebuilt together because the new workspace requires
the provider-settings endpoint absent from the previous control plane.

- Workspace image: `sha256:344c136be232122c36d272925d659298b90c9a148893925f385cd1bf85954975`.
- Control-plane image: `sha256:a1546bd97fd03f46c7920a454663e0374db997627c2f3d30dc09738aa458ee7f`.
- Both services were promoted by immutable image IDs after a PostgreSQL and
  stopped-workspace state backup. Protected recovery records retain previous
  image IDs, runtime versions and the backup location.
- `make validate` passed again. All 76 control-plane tests passed against a
  fresh temporary PostgreSQL database, including provider configuration tests.
  The existing live schema was already at version 10.
- The rebuilt image passed the isolated public CLI smoke test. Its `/app` tree
  and the subsequently running container both matched the upstream fingerprint
  above across all 65,841 entries.
- Both containers became healthy with zero restarts. Deployment doctor passed
  Gateway, desktop, MCP, control-plane, landing and loopback-binding checks.
  Provider configuration returned HTTP 200 internally, while unauthenticated
  administrator access returned HTTP 401. Model readiness and provider
  authentication were true; the Astra compatibility definition and runtime
  selection were preserved. No outbound SMS test was sent.
