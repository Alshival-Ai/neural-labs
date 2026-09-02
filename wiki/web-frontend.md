# Web frontend

The public landing page lives in `web/`. The authenticated React interface
lives in `console/` and is compiled into the `control-plane/` image. First-run
setup remains server-rendered by the control plane so an unbuilt or failed
console cannot weaken the bootstrap checks. Keeping the public static surface
separate makes both runtime containers smaller and their trust boundaries
clearer.

## Directory layout

```text
web/
├── index.html
├── styles.css
├── app.js
└── assets/
    ├── brand/   # Neural Labs logos and marks
    ├── icons/   # Third-party and interface icons
    └── media/   # Page imagery, video, and source media
```

The site is currently plain HTML, CSS, and JavaScript. Keep it framework-free
until application requirements justify adding a build system.

The landing page and control-plane console deliberately use different build
pipelines. See [Administrator settings](desktop-settings.md) for the application UI
routes and validation commands.

## Local preview

From the repository root, run:

```bash
python3 -m http.server 8080 --directory web
```

Then open <http://127.0.0.1:8080/>. The landing page's `/login` link only works
through the complete same-domain Nginx routing configuration.

## Microsoft sign-in assets

Microsoft-provided sign-in button artwork is stored in `web/assets/icons/`.
These files are visual assets only. OAuth configuration and encrypted
credentials are owned by the control plane as described in [Authentication and
administrator model](authentication.md).

Do not place Entra tenant IDs, client secrets, tokens, or generated tenant state
in `web/`. Anything served from this directory must be treated as public.
