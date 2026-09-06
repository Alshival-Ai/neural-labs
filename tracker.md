# Neura roadmap tracker

Source: [September 6 roadmap and meeting notes](roadmap.md). Created September 6, 2026.

This tracker covers the work in those notes. CHAT-01 through CHAT-04, TERM-01, SETTINGS-01, SETTINGS-02, DESKTOP-01, and DESKTOP-02 are
implemented and verified as of September 6, 2026. DESKTOP-01/02 are deployed;
other deployment records remain as noted below.
Remaining tasks are unassigned and stay in Backlog until their requested behavior
is checked. The order below is a suggested sequence.

## Work queue

| ID | Task | Status | Depends on |
| --- | --- | --- | --- |
| CHAT-01 | Limit the initial Your Chats list and add Load more | Done | — |
| CHAT-02 | Make Your Chats collapsible | Done | CHAT-01 |
| CHAT-03 | Clean up image and file attachment presentation | Done | — |
| CHAT-04 | Add attachment download actions | Done | CHAT-03 |
| SETTINGS-01 | Move personal security into Settings → Personal → Security | Done | — |
| SETTINGS-02 | Present plugins as setup cards | Done | — |
| TERM-01 | Add a Team Terminal reaction sidebar | Done | — |
| DESKTOP-01 | Remove the top bar; keep desktop controls in apps | Done | — |
| DESKTOP-02 | Add window edge snapping | Done | DESKTOP-01 |
| DOCS-01 | Create a welcoming wiki home and navigation | Backlog | — |
| DOCS-02 | Provide a complete installation guide | Backlog | DOCS-01 |
| DOCS-03 | Provide Twilio and Microsoft/Outlook setup guides | Backlog | DOCS-01 |

## Completion criteria

### CHAT-01 — Recent private chats

- [x] Show five recent private conversations initially; Load more reveals five additional conversations.
- [x] Provide Load more without losing access to older conversations or the selected chat.
- [x] Adding private chats does not push the Teams section out of the usable sidebar; verify short and narrow windows.

Starting point: [NeuraApp.tsx](workspace/desktop/src/NeuraApp.tsx).

### CHAT-02 — Collapsible Your Chats

- [x] The Your Chats heading expands and collapses its conversation list with an accessible control.
- [x] Collapsing the list leaves the current conversation open and Teams accessible.
- [x] Remember the collapsed state using the existing device-state conventions.

Starting points: [NeuraApp.tsx](workspace/desktop/src/NeuraApp.tsx), [desktop state guide](wiki/desktop-state.md).

### CHAT-03 — Attachment presentation

- [x] In private and Team Chat, images display inline without visible filename or size metadata.
- [x] Other files display their filename once, on the attachment, without an automatically repeated filename in the message body.
- [x] Preserve user-written captions and accessible attachment labels; verify image-only, file-only, and mixed messages after reload.

Starting point: [NeuraApp.tsx](workspace/desktop/src/NeuraApp.tsx).

### CHAT-04 — Attachment downloads

- [x] Attachment menus offer **Download to Workspace** and **Download** for images and other files in private and Team Chat.
- [x] Download to Workspace lets the user choose a workspace destination, handles name collisions, and confirms the saved location.
- [x] Download saves the file to the user's computer through the browser.
- [x] Actions work through right-click and an accessible keyboard/touch menu; expired or unauthorized attachments show a useful error.

Starting points: [NeuraApp.tsx](workspace/desktop/src/NeuraApp.tsx), [Files guide](wiki/files.md).

### SETTINGS-01 — Personal Security page

- [x] Settings includes a dedicated **Personal → Security** page available to regular users for their own account.
- [x] Move personal passkeys and sign-in methods from Personalization into that page; update links and navigation.
- [x] Existing enrollment, removal, and sign-in flows still work, with account-security controls clearly distinguished from administrator settings.

Starting points: [settings guide](wiki/desktop-settings.md), [passkey guide](wiki/passkeys.md).

### SETTINGS-02 — Plugin setup cards

- [x] Plugins uses a card layout consistent with the model-provider settings page.
- [x] Each card presents the plugin name, purpose, configuration status, and a clear setup/manage action.
- [x] Twilio has a dedicated card; preserve existing configuration access and permission checks.
- [x] Verify configured, unconfigured, loading, and error states at desktop and mobile widths.

Starting points: [settings guide](wiki/desktop-settings.md), [Twilio architecture record](wiki/adr/0024-twilio-sms-channel.md).

### TERM-01 — Team Terminal reactions

- [x] Replace the current sticker-image entry point with a right sidebar containing separate emoji and GIF controls.
- [x] Emoji and GIF pickers send reactions to the correct Team Terminal without disrupting terminal input.
- [x] Confirm whether the existing KLIPY integration supplies the required GIF search; handle loading, empty, and unavailable-provider states.
- [x] Verify keyboard/touch access and that the sidebar fits narrow terminals.

Starting points: [terminal guide](wiki/terminal.md), [provider MCP guide](wiki/workspace-provider-mcp.md).
The meeting’s “Clippy” reference is the existing KLIPY integration. Featured/search GIFs, explicit no-filter requests, attribution, and share registration are implemented. Credentials stay outside the tracker and repository.

### DESKTOP-01 — App-only desktop controls

- [x] Remove the top bar and top-edge hover target on every device.
- [x] Keep account controls and sign out in Settings, accessible from the app bar.
- [x] Show live workspace status in Settings for administrators and members.
- [x] Reserve no top space for maximized, split, or phone windows, including touch-only screens.
- [x] Keep app-bar hover reveal suppressed during window manipulation.

### DESKTOP-02 — Window snapping

- [x] Dragging a window to the left or right edge previews the corresponding half-screen layout; releasing applies it.
- [x] Dragging to the top previews maximization; releasing applies it.
- [x] Users can cancel the preview or restore and reposition a snapped window without losing its usable size.
- [x] Snap targets use the unobstructed top edge; verify Neura, Terminal, and other desktop windows.

Starting points: [App.tsx](workspace/desktop/src/App.tsx), [desktop state guide](wiki/desktop-state.md).

### DOCS-01 — Wiki home

- [ ] Introduce Neural Labs, its main capabilities, and who it is for in plain language.
- [ ] Guide readers to installation, everyday usage, and technical integration documentation.
- [ ] Reuse and organize the existing wiki pages; verify navigation on the GitHub wiki after publication.

Starting points: [repository introduction](README.md), [wiki index](wiki/README.md).
Publication target: the GitHub wiki named in [roadmap.md](roadmap.md).

### DOCS-02 — Installation guide

- [ ] Cover prerequisites, configuration, initial startup, authenticated ingress, and claiming the first administrator account.
- [ ] Explain verification, updates, backups, and recovery with links to the relevant runbooks.
- [ ] Check instructions against the supported deployment CLI and use only generic examples.
- [ ] Publish and link the installation guide prominently from the wiki home.

Starting points: [deployment guide](wiki/container-deployment.md), [backup and restore](wiki/backup-restore.md).

### DOCS-03 — Integration guides

- [ ] Document Twilio setup, required configuration, verification, and common troubleshooting steps.
- [ ] Document Microsoft sign-in setup and clarify whether Outlook mailbox integration is a separate supported feature or future work.
- [ ] Keep user setup and operator configuration clearly identified; link to deeper technical documentation where needed.
- [ ] Publish both guides and verify their links and generic examples.

Starting points: [Entra setup](wiki/entra-app-setup.md), [authentication](wiki/authentication.md), [Twilio architecture record](wiki/adr/0024-twilio-sms-channel.md).

## Updating the tracker

Use **Backlog**, **In progress**, **Blocked**, **In review**, or **Done** in the
work queue. When starting a task, record its owner and implementation/PR link
below. A blocked task needs a concrete reason and next action. Mark a task Done
only when its completion criteria are checked and verification is recorded;
record publication or deployment separately rather than implying it from a code change.

| Task | Owner | Implementation / PR | Verification | Deployment / publication |
| --- | --- | --- | --- | --- |
| CHAT-01 | Codex | [Chat sidebar](workspace/desktop/src/NeuraApp.tsx) | Pagination/current-chat unit coverage; browser checks at 1280×900, 1280×420, 390×420, and 320×568 | Pending |
| CHAT-02 | Codex | [Chat sidebar](workspace/desktop/src/NeuraApp.tsx) | Collapse/search tests, device-state persistence, and accessible browser controls | Pending |
| CHAT-03 | Codex | [Shared attachment UI](workspace/desktop/src/ChatAttachments.tsx) | Presentation/normalization tests and PostgreSQL migration/attachment-only message checks | Pending; requires control-plane migration 10 |
| CHAT-04 | Codex | [Attachment actions](workspace/desktop/src/ChatAttachments.tsx), [workspace save decision](wiki/adr/0026-chat-attachment-workspace-saves.md) | Folder/conflict/retry tests; streamed import authorization, limits, and cancellation tests; browser preview and real download checks | Pending |
| TERM-01 | Codex | [Reaction sidebar](workspace/desktop/src/TerminalReactions.tsx), [reaction decision](wiki/adr/0027-team-terminal-reactions.md) | Full emoji/GIF UI tests, KLIPY adapter tests, token/access/cooldown tests, two-participant socket routing, and browser checks at four sizes including split panes | Pending; no database migration |
| SETTINGS-01 | Codex | [Security and Personalization](workspace/desktop/src/UserSettingsApp.tsx), [phone preferences](workspace/desktop/src/PhoneSettings.tsx) | Passkey/account tests, Security and legacy deep links, cross-window phone state, four-size browser verification and notification flow | Pending; no database migration |
| SETTINGS-02 | Codex | [Plugin cards](workspace/desktop/src/PluginCardsPanel.tsx), [provider credentials decision](wiki/adr/0029-settings-provider-credentials.md) | Admin/CSRF/internal token tests, encrypted PostgreSQL storage, stale revisions, runtime lease/rotation tests, responsive setup browser checks | Pending; no database migration |
| DESKTOP-01 | Codex | [Desktop shell](workspace/desktop/src/App.tsx), [desktop guide](wiki/desktop-state.md) | App-bar Settings/account access; no top bar; full-height mouse/touch and short-screen browser checks | Deployed 2026-09-06; no database migration |
| DESKTOP-02 | Codex | [Window placement](workspace/desktop/src/DesktopWindow.tsx), [geometry](workspace/desktop/src/windowGeometry.ts) | Snap/restore/cancellation/legacy state tests; browser drag, iframe, live terminal, pop-out, reload, and five viewport sizes | Deployed 2026-09-06; no database migration |

Verification: `make validate` passed (including 242 desktop tests), seven isolated
PostgreSQL integration tests passed, and both tests in
[mobile-browser.test.mjs](workspace/mobile-browser.test.mjs) passed. Browser checks
use synthetic local fixtures, not production conversations. Migration 10 was
verified against a fresh database and an upgrade from version 9 without rewriting
historical captions. No production deployment or migration was performed for these tasks.

## Decisions to resolve during implementation

- DOCS-03: Whether “Outlook sign-in” means Microsoft account authentication, mailbox integration, or both.

These decisions do not block creation of the tracker or work on independent tasks.

## Confirmed chat decisions

- Five recent private chats initially, five more per click, with a separate Current chat row for an older selected conversation.
- Image clicks open a preview. Historical filename-like captions are preserved when their origin is ambiguous.
- Download to Workspace opens a folder chooser, initially Downloads, remembering the last successful destination per user/device.
- Filename collisions ask for Keep both, Replace, or Cancel. The source attachment cannot replace itself.


## Confirmed terminal decisions and verification

- Team Terminals only, including terminals opened from Neura. Separate emoji and GIF controls in a 44px right rail.
- Full locally bundled emoji catalog with search, categories, skin tones, and the existing eight quick reactions.
- KLIPY featured results and paginated search, explicitly `contentfilter=off`; “Search KLIPY” and “Powered by KLIPY” attribution.
- Emoji displays for 1.8 seconds and GIFs for five seconds, with sender labels and at most three overlays. No saved history or terminal input/output writes.
- Compact pickers open over the visible app area without resizing xterm. Reduced motion uses still previews or text.

TERM-01 final validation: `make validate` passed with 249 desktop tests, 34 MCP
tests, and 115 passing workspace runtime tests (seven opt-in tests skipped).
All three synthetic browser acceptance tests passed; the terminal-specific test
also passed again after the final focus changes. Checks cover 1280×900,
1280×420, 390×420, and 320×568, including a split pane. Screenshots were inspected
for picker fit and visible overlays in short mobile windows. GIF/provider checks
use synthetic fixtures; no production provider requests, deployment, or database
migration were performed for TERM-01.

## Confirmed Settings decisions and verification

- Personal → Security owns sign-in methods, passkeys, and verified phone management.
  Notification preferences remain in Personalization; adding a phone does not opt in.
- Plugin cards cover locked Neural Labs Tools, Twilio, Google Maps, KLIPY, and Pexels.
  Members see status; administrators manage shared credentials in focused details.
- Google Places and Geocoding share one key and show separate connection checks.
- Saved keys are encrypted in the existing plugin table. Disconnect disables the
  provider; Use deployment configuration explicitly restores environment inheritance.
- Configuration refreshes every 15 seconds without a workspace restart. The last
  confirmed configuration has a 60-second lease; failures beyond that disable tools.
  Revision checks prevent stale results and GIF selections surviving key changes.
- Add plugin remains a preview. Deployment is a separate operator step.

SETTINGS-01/02 verification: the validation suite, four isolated PostgreSQL provider
integration tests, and synthetic browser acceptance at 1280×900, 1280×420,
390×420, and 320×568 pass. Screenshots were inspected for card, form, and phone
flow layout. Provider calls and SMS use fixtures; no production credentials,
provider checks, deployment, or migration were performed for these tasks.

## Confirmed desktop decisions and verification

- Remove the top bar on every device. Account controls and live workspace
  status live in Settings; windows start at the top edge.
- Side snaps use full height through the bottom edge. An active snapped or
  maximized window auto-hides the dock; wide touch-only screens get a reveal button.
- Left, right, and top edge previews only. No quarter snapping or automatic tiling
  of other windows. Maximize-button layout menu supports keyboard access.
- Restore retains freeform bounds and pre-maximize placement. Desktop placement
  survives reload, temporary mobile layout, and pop-out/return.

DESKTOP-01/02 verification covers geometry, old saved state, drag cancellation,
resize, focus, shell menus, and live app preservation. Synthetic browser checks
use 1280×900, 1280×420, 820×900 touch, 390×420 touch, and 320×568 touch, with
both reduced-motion and animated shell behavior. Screenshots were inspected.
No production deployment or database migration was performed for these tasks.

Final desktop validation: `make validate` passed with 269 desktop tests, 39 MCP
tests, 57 control-plane tests (19 opt-in tests skipped), and 120 workspace runtime
tests (10 opt-in tests skipped). Both dedicated desktop browser acceptance tests
passed. Deployment remains pending.

Desktop deployment on September 6, 2026: the tested static assets were layered
onto the existing workspace runtime and promoted by immutable image ID. The
previous image is retained for rollback. The workspace reports healthy; the live
entrypoint and asset hashes match the build. Public ingress still requires login.
`make validate` passed, including 269 desktop tests; both desktop browser checks
passed across mouse and touch layouts. Account and SMS configuration persisted
through the workspace restart.
