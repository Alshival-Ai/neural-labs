# Settings app implementation

`SettingsApp.tsx` is the live administrator surface for the Neural Labs
desktop. `App.tsx` renders its dock cog and window only when `/api/session`
reports the active user as an administrator. It is not linked from the account
menu.

The component preserves the Spectrum Paper settings design while replacing all
prototype users, endpoints, versions, and session-only save behavior with the
existing control-plane APIs. Its sections are Overview, Users, Authentication,
MCP, Workspace, Audit log, and About.

`settingsApi.ts` owns the display-safe response types and same-origin request
helper. Mutations send the session CSRF value supplied by the desktop shell.
The server remains authoritative: `/api/admin/*` checks the live active-admin
role for reads and writes and applies CSRF checks to mutations.

The navigation becomes a drawer on narrow screens. Cards, overview metrics,
user rows, credential forms, device pairing, and audit records collapse to
touch-friendly layouts without introducing a separate admin route or service.
