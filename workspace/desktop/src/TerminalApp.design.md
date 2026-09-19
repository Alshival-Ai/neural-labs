# Terminal app implementation

`TerminalApp.tsx` is the production xterm client rendered by `App.tsx` inside a
desktop window. `terminalApi.ts` owns the authenticated same-origin REST calls,
and the workspace runtime in `terminal-manager.mjs` owns PTYs and WebSockets.

The browser never constructs or executes shell commands outside xterm input.
Each pane exchanges typed JSON messages with a ticket-authenticated WebSocket.
Output carries monotonic sequence numbers; reconnect requests the missing
suffix or receives a bounded full replay when the suffix has rolled out of the
server ring.

Personal and Team sessions are server concepts, not cosmetic tab types.
Personal session enumeration and tickets are restricted to their creator. Team
sessions are discoverable and attach every participant to the same PTY. Every
connection sends input immediately, and the server writes it in arrival order.
One invisible layout leader alone sends PTY resize messages so differently sized
browser windows cannot fight over line wrapping; it changes automatically when
that connection leaves. Every connection receives output, presence, typing
activity, layout changes, and ephemeral emoji reactions over its own WebSocket.

The desktop opens directly into Terminal's **New Terminal** launchpad. Discovery
does not create a shell: the user can deliberately start a personal terminal,
resume a running personal terminal, or join a live Team session. The launchpad's
primary **Create a team terminal** action and `+ Team` shortcut open the same
inline name composer beside the live session list. The sidebar and toolbar `+`
menus offer **Personal** (start immediately) and **Team** (open the composer).
A separate home icon returns to New Terminal without creating a shell. Running
sessions remain available in the narrow, independently scrolling rail to the
left of both the launchpad and the terminal canvas. Right-click or Shift+F10
opens actions for a rail session without switching
to it. Menus support arrow keys, Home/End, Escape, outside-click dismissal, and
focus return. On mobile, named session rows expose an overflow action; the menu
portals into the drawer to remain inside its modal focus boundary. Team icons
expose
participant counts at rest and a participant badge card on hover or keyboard
focus. No participant is presented as a driver or spectator.

Terminal layout regions use explicit grid rows: toolbar, optional banners,
stage, and the compact status bar. The stage owns the session rail and the
launchpad or xterm workspace. Keeping these regions explicit prevents an empty
banner row from shifting the xterm canvas and font-size controls into each
other's grid tracks.

At app widths up to 760px, `AppDrawer` replaces the icon rail with searchable,
named sessions. The native modal dialog supplies background inertness and focus
return without duplicating the desktop navigation. Mobile split tabs only change
pane visibility; neither xterm nor its socket is remounted. The touch-key row
sends ordinary authenticated input messages and keeps Ctrl as a one-shot local
modifier. `useMobileAppLayout` observes the app container and visual viewport to
reserve keyboard/dock space; desktop layouts are unchanged. Clipboard failures
are surfaced to the user instead of silently ignored.

`workspace/mobile-browser.test.mjs` exercises a development-only fixture in
`desktop/tests/mobile.html` with synthetic chats and sockets. It checks touch
navigation, composing, input bytes, split connection retention, and narrow-screen
overflow. Run the local Vite server on port 4196 and supply
`PLAYWRIGHT_MODULE_PATH`; optionally select `BROWSER_ENGINE=firefox` or `webkit`.

Closing the desktop window unmounts xterm and sends `detach`; it does not call
the terminal DELETE route. Closing either personal pane confirms before ending
its PTY. Closing a Team
pane or choosing **Leave session** detaches it locally and preserves the shared
shell for rejoining. **End for everyone** confirms before calling DELETE when
the server grants `canTerminate` (creator or admin). Sidebar and pane actions
share handlers and block duplicate termination requests. Intentionally ended
IDs are excluded from stale discovery and socket updates, so terminating the
last personal terminal returns to New Terminal without automatic recovery.

The server sends WebSocket ping frames every 25 seconds. The client retries
indefinitely with jittered exponential backoff capped at 15 seconds and retries
immediately when the browser returns online or visible. No client or server idle
session timeout is configured.

Terminal chrome and xterm use the desktop-wide font scale owned by `App.tsx`.
The status-bar control updates that same per-user, per-browser Appearance
preference; legacy per-terminal `textScale` values are ignored while all other
terminal layout state remains compatible.

## Visual theme

Terminal uses the shared Neural ink/paper palette, spectrum top rule, dark
session rail, violet selections, and ink primary actions with colored offset
shadows. The launchpad, pane headers, status bar, mobile navigation, touch keys,
voice settings, and reaction pickers use warm surfaces and desktop typography.
The reaction dialog defines its own tokens because it portals to `document.body`.

The shell canvas keeps `NEURAL_TERMINAL_THEME` and its high-contrast ANSI colors.
`--terminal-canvas` matches that theme's background so the host, viewport, and
canvas gutters stay consistent. Keep pane rows, xterm insets, and the reserved
reaction rail dimensions intact; visual changes must not alter terminal fitting
or reconnect sessions.

The launchpad introduces terminals as shared social spaces. A compact activity
header leads to a violet-accented team creation card and short explanations of
shared input, opt-in voice, and emoji/GIF reactions. Live team rooms occupy the
main column, with actual participant initials and voice counts. A separate
personal column groups private creation and running personal terminals.

The welcome header includes a shortcut to the team session list and a count of
unique voice participants across running team rooms. Room-name suggestions in
the composer prefill the editable name; they do not create a shell until Start
Team. At narrow widths, sections stack, the room composer wraps, and touch
actions use at least 44px targets. The room shortcut skips the welcome card on
small screens; bottom padding respects the device safe area.

`workspace/terminal-controls-browser.test.mjs` checks creation, menu positioning,
confirmation, inactive-session actions, and mobile overflow menus at four widths
using the same synthetic fixture and Vite/Playwright setup as the mobile suite.
