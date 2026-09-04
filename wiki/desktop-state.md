# Desktop windows and device state

The Neural Labs desktop remembers its presentation independently in each
browser profile. State is stored in same-origin `localStorage` and namespaced by
the immutable signed-in user ID, so two Neural Labs accounts sharing a browser
do not inherit each other's layout.

The desktop restores:

- open and minimized application windows, including multiple windows per app;
- window stacking order, position, size, and maximized state;
- Files location, navigation mode, and list/grid preference;
- Neura's selected conversation, sidebar, and archive visibility;
- Settings navigation; and
- Terminal's active tab, split session, split direction, and locally hidden Team
  Terminal tabs; and
- the VS Code window's visibility, stacking, geometry, and maximized state.

Legacy saved Editor windows are migrated to VS Code windows. These UI-state
records do not include file bodies or unsaved edits, terminal
output or input, Neura message bodies or drafts, access tokens, credentials,
WebSocket tickets, or provider state. Authentication subsystems retain only
their separately documented device identity and session material.

Neura's visible follow-up queue is also excluded from device storage because it
contains prompt text. Once a follow-up is accepted, OpenClaw owns its execution;
the browser keeps only the temporary visual projection used by the open app.

This state does not roam between devices. A phone, tablet, and desktop browser
can each retain a layout suited to that screen. Clearing site data resets the
local layout without deleting workspace files, conversations, terminal
processes, or server state.

A browser profile with no saved desktop state starts with Terminal open. After
that first load, the saved window list is authoritative: closing Terminal and
refreshing the desktop does not reopen it, and a saved minimized Terminal stays
minimized.

## Window and dock behavior

Clicking a visible window brings it to the front. The active window has a
slightly brighter frame. Clicking the dock icon for a background app raises its
most recent visible window. Clicking the frontmost app's icon minimizes its
visible windows; clicking a minimized app restores its most recent window and
its siblings.

The stack is normalized from least recently used to most recently used after
each raise, close, and restore, then persisted in that order. Embedded
same-origin apps such as VS Code bridge pointer and focus activity from their
iframe into the same window activation path. Cross-origin preview frames use
the browser's outer iframe-focus signal. This keeps clicking inside an embedded
app equivalent to clicking any other desktop window.

Maximizing the active window expands it edge-to-edge and enters focus mode. The
desktop topbar and dock slide away while the window expands. Move the pointer to
the top or bottom screen edge, or move keyboard focus into either bar, to reveal
it temporarily. Activating a non-maximized window exits focus mode without
changing the maximized window's saved state.

Right-click an integrated app's dock icon to create a new window, minimize or
restore the app, or close its window set. Each new window has independent
geometry and app presentation state. Closing a Terminal window detaches its
browser views but does not terminate its server-side PTYs; the explicit terminal
tab controls retain their documented end/leave behavior.

Every integrated app window also has a **Pop out** title-bar control. It moves
the existing live app surface into a dedicated browser window; it does not open
a second app instance. Use **Pop back into desktop** in the external title bar,
or right-click the app's dock icon and choose **Bring pop-out back**, to return
it. Clicking a dock icon when all of that app's windows are popped out focuses
the most recent external window. Closing an external browser window returns the
app to the desktop automatically, while the app title bar's close control closes
the app as usual.

Pop-out placement is intentionally temporary device state. Reloading or closing
the Neural Labs desktop closes its child browser windows, and the next desktop
load restores those apps inside the desktop. A browser may require pop-ups to be
allowed for the Neural Labs origin. The pop-out uses the authenticated,
same-origin page and does not create another public endpoint or copy credentials
into its URL.

## Per-window responsive layouts

App layout is based on the width of the app's own desktop window, not the width
of the browser. Every `DesktopWindow` is the named `app-window` CSS query
container and provides the same effective width and `mobile`, `tablet`, or
`desktop` mode to React components through `appViewport.tsx`. App styles use
container queries for presentation; JavaScript reads the shared viewport only
when behavior must change, such as opening Neura history as a drawer.

This keeps an app responsive when its window is resized, maximized, popped into
a separate browser window, or returned to the desktop. Browser media queries are
reserved for the outer desktop chrome, accessibility preferences, and available
height. The minimum freeform window width is 360 pixels so every app can reach
its mobile layout without making title-bar controls unusable. Individual apps
may retain additional intermediate breakpoints for dense tables, sidebars, and
toolbars, but they all query the shared `app-window` boundary.

Minimized Neura, Terminal, and VS Code windows remain mounted. This preserves
Neura's live transcript subscription and local scroll state, Terminal's socket
and emulator, and VS Code's iframe connection and unsaved browser-side editor
state. The desktop stores only the surrounding window presentation.
code-server owns its shared settings, extensions, and editor state below the
persistent workspace home.

## Static asset cache

Content-hashed JavaScript and CSS bundles use a one-year immutable browser
cache. A responsive picture source lets the browser fetch only the wallpaper
matching the current viewport; wallpapers use a one-day freshness lifetime
with a seven-day stale-while-revalidate window. Desktop apps are separate
lazy-loaded bundles, so xterm, Files, Settings, and Neura code is fetched
only when that app is first opened. HTML, authenticated APIs, terminal sockets,
and live workspace data are never included in that static cache policy.
