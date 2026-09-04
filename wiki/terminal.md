# Terminal desktop app

Terminal provides real Zsh PTYs inside the continuously running Neural Labs
workspace container. Open it from the desktop dock. The first launch creates a
private shell in `/home/node/workspace`; **New** creates another private tab and
the two split controls create a new private shell beside or below the active
one.

## Session behavior

- A personal terminal is listed only for the signed-in user who created it.
- Closing a personal terminal tab ends its shell process.
- Closing, minimizing, or reloading the Terminal app only detaches its view.
  The PTY keeps running through browser sleep and network loss.
- Sessions are runtime-persistent. Recreating or restarting the workspace
  container ends them; files written to the shared workspace or persistent home
  still follow the normal volume persistence rules. An open desktop detects the
  stale private-session identifier and provisions a fresh shell automatically.
- There is no idle timeout. The browser reconnects indefinitely with bounded
  exponential backoff and resumes output from its last sequence when possible.
- Each browser remembers its active terminal tab and split layout. This stores
  session identifiers and presentation choices only; terminal input, output,
  scrollback, and socket tickets are not written to browser storage.

The terminal toolbar reports connection state. **Reconnect** retries
immediately when a connection is degraded. Search incrementally highlights
matches in xterm's live terminal buffer.

The status bar includes text-size controls. Scale ranges from 90% to 160%,
defaults to 120%, and enlarges both terminal UI labels and xterm glyphs. It is a
per-browser presentation setting: changing it refits the local canvas but does
not resize another participant's window or alter their preferred text size.

Terminal never uses Server-Sent Events. Authenticated HTTP creates the PTY and
issues its short-lived one-use ticket;
the interactive channel itself is a WebSocket. Input, output, resize, replay,
presence, and layout messages all use that socket. A connection that upgrades
but never completes the terminal-ready handshake is closed after ten seconds
and retried with bounded backoff.

## Team Terminals

Choose **Team** in the Terminal app to create or join a workspace-wide Team
Terminal, which every approved Neural Labs user can discover. A Team Chat has a
collapsible terminal rail on its right edge. The plus action creates a new
terminal for that channel, while the expanded rail shows active and ended
sessions, the channel members who can join, and the participants currently
connected to each PTY. Only current channel members can discover or join these
sessions. This includes restricted-channel membership and the dynamic
active-user audience of an Everyone channel.

Each participant has an independent authenticated WebSocket attached to one
shared server-side PTY, so everyone sees the same prompt, typed text, program
output, and full-screen terminal program. Leaving its tab does not end the
shell. The creator or an administrator can use **End for everyone** to stop it.
If a channel member is removed or disabled, new discovery and connections fail
closed and an existing socket is closed by the periodic access recheck.

Every attached participant can send keystrokes immediately. Input is written to
the shared PTY in the order it reaches the server, so teammates can type and
interact fluidly without claiming control or waiting for a turn. The first live
connection remains an invisible layout leader for PTY dimensions only; this
prevents browser windows with different sizes from repeatedly fighting over
line wrapping, and layout leadership passes automatically when it disconnects.

Presence avatars identify connected teammates, and brief typing attribution
makes collaborative command entry easy to follow.
The smile action sends an ephemeral emoji sticker to every connected viewer.
Stickers are rate-limited, are not written into the PTY, and are not persisted.
Raw input is not duplicated into a social event: terminal echo is the source of
visible typed text, which preserves normal no-echo behavior for password prompts.

### Voice chat

Each live Team Terminal has an optional voice room. **Join voice** starts in the
muted, listen-only mode without requesting microphone access. The settings menu
offers three device-local modes:

- **Muted** receives teammates without sharing a microphone.
- **Open mic** keeps the microphone track enabled while the room and terminal
  socket are connected.
- **Push to talk** enables the microphone only while the dedicated **Hold to
  talk** button is held by pointer, touch, Space, or Enter.

Leaving voice stops the local microphone tracks and closes all peer connections.
Closing the terminal pane has the same effect. Minimizing its desktop window
keeps the mounted terminal and voice room active. Reconnecting the terminal
socket automatically rejoins an intended voice room but keeps the microphone
disabled until signaling is ready again.

Voice is an eight-device WebRTC mesh. Browsers use a direct encrypted media path
when possible and fall back to the Neural Labs TURN relay when routing or a
firewall prevents that path. The authenticated Team Terminal WebSocket carries
ephemeral presence, session descriptions, ICE candidates, and one-hour relay
credentials only; it never carries, records, or persists audio. Relay usernames
contain a pseudonymous user key rather than an account identifier.

The deployment must expose the configured TURN port over TCP and UDP and the
configured relay range over UDP. When the host is behind NAT, forward those
ports to `NEURAL_LABS_TURN_RELAY_IP` and set
`NEURAL_LABS_TURN_EXTERNAL_IP` to the public address advertised by DNS.

## Interactive shell

New terminals use Zsh with Debian-packaged syntax highlighting and command
autosuggestions. Completion is case-insensitive, Up/Down search history by the
current prefix, Git branches appear in the right prompt, and common color/`ls`
aliases are enabled. Bash remains installed and uses familiar Readline bindings
when launched explicitly.

Personal terminal history is separated by Neural Labs user. Each Team Terminal
gets its own shared history file. This prevents one user's personal Up-arrow
history from appearing in another user's personal terminal while retaining
useful history within a collaborative shell.

The maintained profile lives in the image. Put deployment-specific or personal
additions in `~/.zshrc.local`; Neural Labs sources it without replacing the
maintained defaults.

## Clipboard and keys

Terminal keeps the standard developer conventions:

- `Ctrl+C` sends an interrupt to the running process.
- `Ctrl+Shift+C`, `Cmd+C`, or `Ctrl+Insert` copies selected text.
- `Ctrl+Shift+V`, `Cmd+V`, or `Shift+Insert` pastes.
- `Insert` toggles Insert and Overwrite editing. The cursor is a bar in Insert
  mode and a block in Overwrite mode; the pane header reports `INS` or `OVR`.
- The pane toolbar exposes Copy, Paste, and Clear for pointer users.

OSC 52 clipboard access is not enabled, so terminal programs cannot silently
read or replace the browser clipboard. Paste still sends data to a live shell;
review multiline commands before pasting into a privileged session.

xterm generates runtime styles for its viewport, rows, cursor, and canvas. The
workspace server places a fresh nonce in every desktop HTML response and the
terminal's document adapter applies that nonce to xterm-created `<style>`
elements. The pinned xterm release also has two library-global styles outside
that adapter; CSP allowlists only their exact SHA-256 hashes. CSP continues to
allow scripts only from the same origin. Inline style attributes are allowed
separately because xterm uses `element.style` for geometry; ordinary Terminal
UI scaling uses static CSS classes.

## Security boundary

The PTY is created by the workspace service and points at the fixed Zsh binary
in the workspace container (falling back to Bash if Zsh is unavailable). It
never exposes a host shell or Docker
socket. WebSocket upgrades require the authenticated, Nginx-injected user ID,
the exact Neural Labs origin, and a short-lived one-use ticket bound to that
user. A bounded output backlog and socket buffer prevent unlimited memory
growth.

The broader shared-workspace trust model still applies: every approved developer
can modify shared files, and passwordless `sudo` grants root only inside the
workspace container. Personal terminal visibility does not make shared files or
container credentials private from other mutually trusted developers.
