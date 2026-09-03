# Changelog

All notable Neural Labs changes are recorded here. Releases use Semantic
Versioning and Git tags in the form `vMAJOR.MINOR.PATCH`.

## [Unreleased]

## [0.3.0] - 2026-09-03

### Added

- Added Microsoft-bootstrapped passkey enrollment in Personalization and
  discoverable, user-verifying passkey login for existing approved accounts.
- Added a full-window graphical Skill Builder with synchronized metadata and
  canonical source views for `SKILL.md`, `agents/openai.yaml`, references,
  scripts, assets, invocation policy, icons, and MCP dependencies.
- Added durable server-side drafts with Yjs character-level collaboration,
  presence, owner-selected collaborators, administrator oversight, validation,
  explicit publication, and shared unpublished Neura tests.
- Added a graphical automation draft flow, including a first-class **Run a
  skill** action that emits the canonical `$skill-name` invocation.
- Added a Personalization card where every user connects, monitors, pauses, and
  resumes their own ChatGPT device-code session for interactive Neura.
- Added one isolated OpenClaw agent/auth directory and one exact Gateway agent
  role per Neural Labs user, provisioned from the immutable user ID.
- Added durable, redacted Team Chat work timelines for plans, commands, file
  operations, tool actions, and results.

### Changed

- Refreshed the sign-in, signup, pending-access, setup, and administrator
  surfaces with one responsive light paper-and-spectrum account experience.
- Skills is now the canonical reusable-workflow app. The Automations dock icon
  focuses its Automations section rather than opening a second app instance.
- Regular users can inspect redacted operational automation state and history;
  unredacted configuration and all scheduler mutations remain administrator-only.
- Skill shortcuts now use one lowercase, hyphenated `$skill-name` form, and a
  published slug is immutable.
- Skill details now fetch and render the live OpenClaw `SKILL.md` instruction
  body in a bounded document viewer. Installed OpenClaw skills have a dedicated
  detail pane, and automation prompts use the same scrollable Markdown treatment.
- Private Neura now uses the signed-in user's personal OpenClaw agent instead of
  the shared `main` agent. Missing or paused personal auth fails closed.
- Team Chat `$Neura` turns use the message author's personal OpenAI account and
  receive prior shared work details alongside the bounded channel transcript.
- The workspace `main` OpenAI connection is now explicitly reserved for
  automations, heartbeats, and other background/system work.

### Fixed

- Fixed desktop restoration forcing Terminal open even when the browser's saved
  per-user window state had Terminal closed or minimized.
- Fixed installed Skills remaining on “Loading” because the UI requested
  OpenClaw's optional `skill-card.md` instead of the actual `SKILL.md`. Static
  instructions now use an authenticated, allowlisted read while live skill
  status continues over the Gateway WebSocket.
- Fixed interactive Neura usage being attributed to the administrator's shared
  workspace OpenAI account.
- Fixed periodic personal-access reconciliation reapplying the `unlinked` role
  and disconnecting an already restricted Neura browser every 30 seconds.

### Security

- Passkey ceremonies bind to the configured public origin and hostname, consume
  five-minute challenges once, require authenticator user verification, rate
  limit anonymous attempts, and store public credential material only.
- Builder HTTP and WebSocket operations derive identity from authenticated
  ingress, require the configured origin for mutations, authorize each draft,
  constrain package paths and sizes, and reject common credential shapes.
- The builder adds no public port and does not widen the ordinary Neura
  Gateway scopes.
- Personal OAuth tokens stay in per-agent OpenClaw auth storage and are never
  returned to the browser or stored in PostgreSQL. The default Gateway role has
  an empty agent allowlist, and personal roles allow exactly one agent with no
  access to other users' sessions.
- A runtime-generated, rotating Gateway password is limited to the Gateway and
  workspace loopback role-management client, is not persisted in configuration
  or inherited by agent runs, and adds no new listener or host port.
- Team Chat activity persistence applies size limits, credential-pattern
  redaction, and generic reasoning labels rather than exposing raw reasoning.
- Team Chat passes its bounded transcript through a private, short-lived file
  instead of exposing it in process arguments; trusted-proxy loopback identity
  spoofing remains disabled.

### Operations and compatibility

- Database migration 5 adds a bounded JSON activity projection to Team Chat
  agent-run records; it adds no credential column or table.
- Database migration 6 adds passkey public-key metadata and expiring one-time
  ceremony challenges; authenticator private keys remain on user devices.
- The first upgraded workspace start removes legacy `main`-agent
  `neura-private` sessions. This development migration is intentionally not
  reversible from application state; restore a pre-upgrade volume backup if
  that history is required.
- Rebuild and recreate the control-plane and workspace containers after
  upgrading. Existing workspace files, system automation auth, personal OpenAI
  auth, skill drafts, and code-server data remain in their persistent volumes.
- Full design, trust-boundary, validation, upgrade, and rollback details are in
  [the v0.3.0 release record](wiki/releases/v0.3.0.md).

## [0.2.0] - 2026-09-02

### Highlights

- Reworked Terminal into a social coding surface that opens on a focused
  **New Terminal** launch page with discoverable Team sessions.
- Added authenticated, same-origin VS Code as a first-class desktop app backed
  by the shared workspace filesystem.
- Added pop-out and pop-in controls to every integrated desktop app window.
  Live app surfaces move between the desktop and a separate browser window
  without creating a duplicate app instance.
- Made Neura steering reliable during active work and added a visible FIFO
  follow-up queue that advances automatically after each run.

### Added

- A scrollable Team session rail with compact session icons, live connection
  state, participant badges on hover or keyboard focus, and controller status.
- An inline **+ Team** flow for naming and starting a collaborative terminal;
  the previous team-selection dropdown is no longer part of the launch flow.
- Resume actions for recent personal terminals and join actions for running
  Team terminals.
- A VS Code dock icon, desktop window, load status, reload action, and an
  optional open-in-tab action.
- A managed local code-server child process with readiness reporting and
  persistent user settings and extensions.
- A same-origin authenticated HTTP and WebSocket proxy for the embedded VS Code
  surface.
- Per-window **Pop out** and **Pop back into desktop** controls for Neura,
  Files, Editor, Preview, VS Code, Terminal, Automations, Skills, and Settings.
- Dock actions to focus an external app window or bring one or more pop-outs
  back into the desktop.
- Automatic recovery when a pop-out is closed with browser chrome, plus clear
  guidance when a browser blocks the requested window.
- A compact Neura run-state banner and scrollable queued-message panel with
  queue positions, attachment counts, and per-message removal.
- Compact, expandable Neura work timelines for thinking status, plans,
  commands, file operations, tool actions, command output, and durable history.
- A **Copy path** action for Files context menus that copies the selected file
  or folder's `~/workspace/...` path and reports clipboard permission failures.

### Changed

- Terminal is the active app on desktop startup. The terminal emulator is
  created only after the user starts, resumes, or joins a session.
- Terminal launch controls, text scaling, empty states, and responsive layouts
  were simplified to keep the coding surface primary.
- Minimized Neura, Terminal, and VS Code surfaces remain mounted to preserve
  their live browser-side state.
- Desktop window titles now reserve space for four controls and truncate long
  preview titles cleanly.
- Neura now treats Enter as immediate steering for the complete lifetime of an
  active run. Ctrl/Cmd+Enter admits a Gateway-owned follow-up instead of relying
  on a browser-side timer.
- Neura keeps its transcript mounted during Gateway reconnects and reconciles
  durable history without replacing stable message nodes.

### Fixed

- Fixed the Terminal status and text-size row expanding into the content area
  and covering the terminal when no emulator was mounted.
- Fixed startup behavior that could restore an unrelated app above Terminal.
- Fixed small-screen window-control targeting so adding the pop-out action does
  not hide the close control.
- Fixed persisted assistant updates and follow-up admission acknowledgements
  incorrectly marking Neura idle while the original agent run was still active.
- Fixed sessions that were already running when Neura opened not exposing the
  steer, queue, and stop controls until another streaming event arrived.
- Fixed Neura clearing and rebuilding its transcript during a Gateway WebSocket
  reconnect, which could reset the reader to the top of a long chat.
- Fixed transcript updates either stealing the reader's position or failing to
  follow new messages. Bottom-follow now pauses after an intentional upward
  scroll and resumes through a visible **Latest** action.
- Fixed dock clicks minimizing an app that was open behind another window.
  Clicking a background app now raises its most recent window; clicking the
  already-frontmost app still minimizes it.

### Security

- code-server listens only inside the workspace container and is not published
  as a host port.
- VS Code requests continue through existing authenticated workspace ingress.
  The proxy requires trusted identity, enforces same-origin mutation and
  WebSocket requests, and strips inbound credential and identity headers before
  forwarding.
- Embedded VS Code framing is limited to the same origin. The broader desktop
  remains non-embeddable.
- Pop-outs use a blank same-origin browser document and never place app state,
  credentials, or session material in a URL.
- Downloaded code-server archives are verified against architecture-specific
  checksums during the image build.

### Operations and compatibility

- No database migration is required.
- Existing per-device desktop state remains compatible. A pop-out is restored
  as an ordinary desktop window after a desktop reload.
- Deploying this release requires rebuilding and recreating the workspace
  container. Persistent files, settings, extensions, and server-side terminal
  metadata remain in their existing volumes; running terminal processes end
  during container replacement.
- Full release details, validation evidence, upgrade notes, and rollback steps
  are in [the v0.2.0 release record](wiki/releases/v0.2.0.md).
