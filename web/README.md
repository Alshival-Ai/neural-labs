# Replaceable landing site

`web/` is a self-contained static starter site served by `server.mjs` in the
`landing` container. It has no build step, framework dependency, or runtime asset
dependency on Alshival.Ai. Replace the copy, sections, navigation links, metadata,
and brand assets in `index.html`, or replace the entire site without rebuilding
the workspace or control plane.

## Appearance

- `styles.css`: editorial layout and section styles.
- `assets/ui/theme.css` and `theme.js`: warm-paper/jet-black surfaces, filled
  spectrum buttons, and the Light/Dark/System selector. The script runs before
  styles load. Preferences persist under `neural-labs-public-theme`; System
  follows the device. Existing `auto` preferences are interpreted as System.
- `assets/ui/navigation.css` and `navigation.js`: desktop hover/focus expansion,
  optional pinning, mobile icon rail/drawer, and the selected spectrum cube.
  Pin preference uses `neural-labs-public-sidebar-pinned`. The header account
  action paints a 32px-high capsule inside a 44px target, with a 16px spectrum
  mark; preserve both Sign up and Workspace labels supplied by session state.
- Keep the sidebar outside `.public-page`. That wrapper moves with the desktop
  menu and becomes inert when the mobile drawer is open. Each menu link has an
  accessible label independent of its collapsed visual label. Update anchor
  targets and icons together when replacing sections.

The interface remains navigable if enhancement scripts fail. Animations respect
reduced motion. Theme controls synchronize between tabs and remain usable when
browser storage is unavailable.

## Reusing the appearance selector

The landing and login-unavailable page use the same self-contained markup and
assets. The selector is a `role="radiogroup"` with `data-theme-control` and three
native buttons (`role="radio"`, `data-theme-choice="light|dark|system"`). Use
inline, decorative SVGs in sun/moon/computer order; retain the accessible names
Light, Dark, and System and the per-button tooltips. Hide the control until its
handlers are ready. No icon font or runtime request to another site is needed.

The painted capsule is 32px high, inside a 44px interaction area; every button
has a 44×44px target. `--theme-track`, `--theme-border`, `--theme-icon`,
`--theme-selected`, `--theme-selected-ink`, and `--theme-focus` are scoped to
`.theme-control` and map the appearance to local palette tokens. Selected
preferences receive a filled indicator. Keyboard focus has its own ring.
Arrow keys wrap selection, Home/End select the first/last option, and Tab visits
only the selected radio in each group. Space and Enter retain native behavior.

The controller keeps `data-theme` (`light`, `dark`, or `system`) separate from
the resolved `.light-style`/`.dark-style` class and `color-scheme`. Changing the
device theme never moves the selected indicator away from System. Missing,
legacy `auto`, cleared, or invalid preferences default to System. Explicit
choices override device changes, synchronize across tabs, and remain usable
without storage. CSS follows the device when JavaScript is unavailable.

For later Alshival/portal adoption, reuse the markup and scoped control styles;
adapt the theme controller to those sites' existing storage and class contracts.
Do not import their assets over the network or change their saved preferences
from the Neural Labs landing container. This pass changes only the landing and
its unavailable-login fallback, not the console or authentication service.

## Authentication boundary

The reverse proxy sends `/login`, `/signup`, `/auth/`, and `/api/` to the control
plane. The landing site stores no identity, token, credentials, or account data.
`navigation.js` reads same-origin `/api/session` with caching disabled to choose
between guest and signed-in labels, refreshing when the tab regains focus.
Failures keep the normal guest links usable.

Guests see **Sign up** (`/signup`) and sidebar **Log in** (`/login`). Sign up uses
the existing access-request page and its configured providers; workspace access
still requires approval. Signed-in visitors see **Workspace**, linked through
`/login` so the control plane applies the correct role/account-status redirect.
The landing site does not decide authorization or assume an active account.

When the landing container runs alone, `/login` and `/signup` return the themed
setup page with HTTP 503. Connecting a different backend means adapting these
links and the optional session lookup, plus the reverse-proxy routes. Static
assets should live under `/assets/`; the static server intentionally denies
source files and arbitrary root paths.

## Verify and deploy

Run `node --test web/*.test.mjs web/*.test.cjs` from the repository root for
static-server, navigation, and theme behavior. `make validate` includes these.
For a local preview, run `node web/server.mjs` (default port 4173).

Building and deploying are separate operator steps. Build with
`docker build -f web/Containerfile -t neural-labs-landing:<release> .`, retain the
previous immutable image for rollback, then select the new immutable image for
**only** the `landing` service using the deployment's current Compose descriptor.
Do not rebuild or recreate workspace/control-plane services for a landing edit.
If the managed updater is active, follow `wiki/workspace-updates.md` before any
host deployment; do not bypass its protected descriptor.
