# Desktop windows and device state

The Neural Labs desktop remembers its presentation independently in each
browser profile. State is stored in same-origin `localStorage` and namespaced by
the immutable signed-in user ID, so two Neural Labs accounts sharing a browser
do not inherit each other's layout.

The desktop restores:

- open and minimized application windows, including multiple windows per app;
- window stacking order, position, size, and maximized state;
- Files location, navigation mode, and list/grid preference;
- Editor file paths, active tab, open tabs, and panel/view choices;
- Neura's selected conversation, sidebar, and archive visibility;
- Settings navigation; and
- Terminal's active tab, split session, split direction, and locally hidden Team
  Terminal tabs.

Restored Editor files are fetched again from the authenticated workspace API.
These UI-state records do not include file bodies or unsaved edits, terminal
output or input, Neura message bodies or drafts, access tokens, credentials,
WebSocket tickets, or provider state. Authentication subsystems retain only
their separately documented device identity and session material.

This state does not roam between devices. A phone, tablet, and desktop browser
can each retain a layout suited to that screen. Clearing site data resets the
local layout without deleting workspace files, conversations, terminal
processes, or server state.

## Window and dock behavior

Clicking a visible window brings it to the front. The active window has a
slightly brighter frame. Clicking the dock icon for an app with visible windows
minimizes all of that app's windows; clicking it again restores the most recent
window and its siblings.

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

## Static asset cache

Content-hashed JavaScript and CSS bundles use a one-year immutable browser
cache. A responsive picture source lets the browser fetch only the wallpaper
matching the current viewport; wallpapers use a one-day freshness lifetime
with a seven-day stale-while-revalidate window. Desktop apps are separate
lazy-loaded bundles, so xterm, Editor, Files, Settings, and Neura code is fetched
only when that app is first opened. HTML, authenticated APIs, terminal sockets,
and live workspace data are never included in that static cache policy.
