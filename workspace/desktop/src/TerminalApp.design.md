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

Closing the desktop window unmounts xterm and sends `detach`; it does not call
the terminal DELETE route. Closing a personal tab explicitly ends its PTY.
Closing a Team tab only hides it locally, while **End for everyone** calls DELETE
after confirmation when the server grants that capability.

The server sends WebSocket ping frames every 25 seconds. The client retries
indefinitely with jittered exponential backoff capped at 15 seconds and retries
immediately when the browser returns online or visible. No client or server idle
session timeout is configured.

Terminal chrome and xterm use the desktop-wide font scale owned by `App.tsx`.
The status-bar control updates that same per-user, per-browser Appearance
preference; legacy per-terminal `textScale` values are ignored while all other
terminal layout state remains compatible.
