# Native runtime preparation: source components only

This change is not an installable OpenClaw-free release. Existing images,
deployment manifests, admission rules and the workspace entry point are unchanged.
Do not upgrade an installation or reset chats using this source change alone.

Implemented components and operator usage are documented in
[`workspace/native/README.md`](../../workspace/native/README.md).
The trust boundaries and remaining release gates are in
[ADR 0040](../adr/0040-native-runtime-migration.md).

## Verified

- `VITEST_MAX_WORKERS=2 make validate` passed in an isolated checkout. The
  ordinary run skips PostgreSQL integration and optional Playwright cases;
  those skips are not browser or database acceptance claims.
- All 134 control-plane tests passed separately against a disposable PostgreSQL
  database, including the new preservation snapshot test. The fixture used tmpfs
  storage, a loopback-only port and no production mounts; it was removed afterward.
- Native migration fixtures exercise hashes, metadata, binary draft state,
  retained history, explicit classifications, interruption, duplicate claims,
  unknown outcomes, workflow locks, stale definition races and account bindings.
  The fixture baseline contains 12 team packages, one personal package, 27 draft
  directories, 19 jobs, 124 receipts, three scratch records and 20 proposals.
  These are fixture counts, not a current installation inventory.
- Mocked Codex and Claude streams exercise output, native session persistence,
  approval scoping, background blocked outcomes, cancellation and lease revocation.
  Four independent jobs and four mixed-provider conversations run concurrently
  in fixtures without a global execution semaphore.
- Real Codex 0.155.1 initialization and empty thread listing passed through the
  new stdio transport in a separate network-disabled, read-only container with
  an empty account home. Claude Code 2.1.226 structured-host initialization
  passed under the same isolation. No account credentials or inference were used.
- Companion portal regressions passed: 73 tests with one skip, covering managed
  runtime/proxy, workspace API/MCP contracts and internal workspaces. Another
  36 host upgrade/migration/stack/authorization tests passed using local fixtures.

## Still required before release

- Integrate the credential filesystem launcher with execution leases, then wire
  runtime API/event transport, native account/login flows and approval UI into
  the existing desktop. Preserve terminal participation and background policy.
- Port all application tools and media behavior to MCP; integrate the native
  skill library and provider-specific discovery without rewriting originals.
- Install pinned Supercronic and its fixed runner; validate calendar/DST,
  process/stream triggers, restart and overlap behavior in real containers.
- Implement and validate administrator connector settings, SMTP/Gmail/direct
  Twilio paths, token refresh/consent and uncertain delivery behavior.
- Build/publish immutable native amd64 and ARM64 images, update onboarding and
  managed upgrade contracts, and verify that the resulting runtime has no
  OpenClaw binaries, packages, Gateway dependency or recurring discovery.
- Re-inventory the target after draining, export complete filesystem/SQLite/
  PostgreSQL preservation state, compare hashes and every record, and validate
  recovery before the explicitly scoped pilot cutover. Never use fixture counts
  as evidence that a live workspace was preserved.
- Finish actual account connections and observed scheduled execution, then
  measure the complete workload on native ARM64 with 8 GB RAM before claiming Pi
  acceptance. Keep customer installations pinned until the pilot passes.

No native image digest, production cutover, live inference, hardware benchmark,
chat reset or NAS recovery verification is claimed by this preparation record.
