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
sessions are discoverable and attach every participant to the same PTY. Exactly
one Team connection is the controller and alone sends input and PTY resize
messages; any participant can take control. Every other connection remains a
live spectator that receives output, presence, typing activity, control changes,
and ephemeral emoji reactions over its own WebSocket.

The desktop opens directly into Terminal's **New Terminal** launchpad. Discovery
does not create a shell: the user can deliberately start a personal terminal,
resume a running personal terminal, or join a live Team session. The launchpad's
`+ Team` action opens the only Team-terminal creation flow as an inline composer
beside the live session list; terminal toolbar actions remain focused on the
active shell. Running sessions remain available in the narrow, independently
scrolling rail to the left of both the launchpad and the terminal canvas. Its
Team-create shortcut returns to the same inline composer. Team icons expose
participant counts at rest and a participant badge card on hover or keyboard
focus; the current controller is identified in that card.

Terminal layout regions use explicit grid rows: toolbar, optional banners,
stage, and the compact status bar. The stage owns the session rail and the
launchpad or xterm workspace. Keeping these regions explicit prevents an empty
banner row from shifting the xterm canvas and font-size controls into each
other's grid tracks.

Closing the desktop window unmounts xterm and sends `detach`; it does not call
the terminal DELETE route. Closing a personal pane explicitly ends its PTY.
Closing a Team pane only hides it locally, while **End for everyone** calls DELETE
after confirmation when the server grants that capability.

The server sends WebSocket ping frames every 25 seconds. The client retries
indefinitely with jittered exponential backoff capped at 15 seconds and retries
immediately when the browser returns online or visible. No client or server idle
session timeout is configured.

Terminal chrome and xterm use the desktop-wide font scale owned by `App.tsx`.
The status-bar control updates that same per-user, per-browser Appearance
preference; legacy per-terminal `textScale` values are ignored while all other
terminal layout state remains compatible.
