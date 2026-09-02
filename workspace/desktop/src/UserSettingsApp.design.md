# Settings Personalization implementation

`UserSettingsApp.tsx` provides the Personalization panel inside the Neural Labs
desktop Settings application. Every active user opens Settings from its dock
cog. Members see only Personalization; administrators see it alongside the
control-plane areas. The account menu no longer launches a separate settings
window.

The panel shows only the current session's display-safe user fields and linked
provider names. Its Appearance card controls a 90–150% desktop-wide font scale
in 10% steps.
The preference is stored per user in this browser, changes semantic text sizes
without changing window geometry, icons, or spacing, and also controls xterm's
rendered font size through the same shared state.
It loads public provider availability from `/api/auth/providers`, links a local
password through the existing CSRF-protected account endpoint, starts Microsoft
linking through the existing one-time OIDC flow, and reuses the desktop logout
action.

Legacy `/account` visits and Microsoft identity-link returns redirect to
`/workspace?settings=personalization`. The desktop consumes that launch flag,
opens Settings at Personalization with any success or error notice, and removes
the query string from the address bar. The old `user-settings=1` launch flag is
accepted only as a client-side migration aid. The control plane remains
authoritative for identity, session, same-origin, and CSRF checks; the workspace
receives no additional secret or database access.
