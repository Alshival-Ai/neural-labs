# Terminal desktop app

Terminal provides real Zsh PTYs inside the continuously running Neural Labs
workspace container. Open it from the desktop dock. The first launch creates a
private shell in `/home/node/workspace`; **New** creates another private tab and
the two split controls create a new private shell beside or below the active
one.

## Session behavior

### Phone layout

The top-left menu opens a searchable session drawer with named private and Team
terminals, new-session actions, and **Add split pane**. Selecting a session or
tapping outside closes the drawer; closing the drawer never ends a shell.
On narrow windows, split panes become named tabs. Both xterm clients and their
connections remain mounted while one pane is visible. Wider windows restore
the saved split direction.

Touch keys provide **Keyboard**, a one-shot **Ctrl** modifier, **Esc**, **Tab**,
arrows, and **Ctrl+C** (scroll the key row for more). Keyboard focus is deliberate,
not triggered by reconnecting or changing panes. Copy and Paste stay accessible;
if browser clipboard permission is unavailable, the app explains how to use the
phone keyboard's Paste action. The terminal canvas refits above the visible
keyboard and desktop dock, and font-size controls have larger touch targets.

### Persistence

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
The right rail contains separate **Emoji** and **GIF** controls. The full emoji
picker offers search, categories, skin tones, and eight quick reactions. GIFs use
KLIPY featured results and search, with Load more for additional results. GIF
search explicitly requests no content filter; provider catalog/account restrictions
still apply. Missing KLIPY configuration disables GIF search while emoji remains
available. Provider errors offer Retry.

Selecting a reaction sends it to connected viewers of that Team Terminal and
returns focus to the shell. Emoji lasts 1.8 seconds; GIFs last five seconds. Each
shows the sender's name, with at most three reactions on screen. Reduced-motion
users see still previews or text. No reaction writes to the PTY, enters the output
replay, or creates saved history. Emoji has a 400ms sender cooldown and GIFs have
a two-second cooldown, shared across that sender's connections to the terminal.

Pickers support keyboard navigation, Escape to close, and touch controls. Compact
panes open a picker over the app area; opening it does not resize the shell.
Short mobile windows hide the secondary status bar and the passive Neura helper
line to leave space for the shell and reaction rail. Active Neura participation
and participation controls remain visible. These controls apply to Team Terminals,
including those opened inside Neura; personal shells have no reaction sidebar.
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

## Working with Neura

Neura can open Terminal for an interactive session **with you**, run a command,
read recent output, and type into the same process. Ordinary background commands
continue to use the agent's command-execution tools.

You can also open Terminal yourself, run a command, switch to Neura, and ask about
it. Each message automatically includes snapshots of the three terminal sessions
you most recently created, focused, or typed in. Each snapshot includes metadata
and up to 4 KiB of eligible recent output, including output from before Neura
opened. There is no selector to manage. Background logs, reconnects, and Neura's
own tool activity do not move terminals ahead of the ones you are using.

Snapshots stay fixed for the submitted message, including queued messages. Neura
can fetch more of the existing session buffer when needed and asks which terminal
only when the request is ambiguous. Agent input always names an explicit terminal
ID. Removed sessions disappear from future context. Neura does not run continuously
in the background.

Personal terminals are available in their owner's private chats. Team Terminals
are available in their own Team Chat and in current members' private chats. Team
context is never automatically carried into another channel. Access is checked
again for each tool operation. Asking a question permits inspection; Neura's
instructions require an action request before typing.

**Neura can read and type** means agent participation is available. The additional
participation indicator appears when a tool is accessing the session. **Pause
Neura** switches to status-only access and blocks agent input. The owner controls
personal sessions; a Team Terminal's creator or an administrator controls its
shared setting. All connected viewers see changes.

Output produced while paused is never available through subsequent Neura reads,
even after sharing resumes. It remains visible in the human terminal. Already
shared output cannot be withdrawn from an existing conversation. Output sharing
includes anything a program echoes; there is no automatic secret detection.
Credential sessions opened by Neura must start in status-only mode. Enter secrets
directly into the program's masked prompt. Masking depends on the program, and
Terminal is not a credential store.

History is bounded to the existing 2 MiB session buffer and is discarded when the
session is removed or the workspace restarts. Reads report gaps and truncation.
No persistent terminal recording is added. Neura cannot recover discarded output
or attach to an unrelated background command.

Interactive launches require a connected desktop. One desktop claims the launch,
focusing or restoring its Terminal window; the command starts only after that
terminal completes its ready handshake. Unconnected launches expire after 30
seconds. Repeating the same request ID checks the original launch without running
the command again.
