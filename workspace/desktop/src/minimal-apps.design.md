# Shared desktop app UI

Terminal, Settings, Skills/Automations and Neura share `minimal-apps.css`.
This product theme keeps Neural Labs color in navigation marks, selected rows,
primary actions and a thin spectrum rule. Working surfaces are light and flat;
errors, account status and execution states retain their semantic meaning.

Use short task labels and one clear primary action per area. Navigation shows
labels without repeated descriptions. Terminal starts with personal and team
sessions rather than a promotional panel. Skills emphasize instructions and
sharing; requirements and unavailable status remain visible when relevant.
Automation counts are compact and wrap on narrow windows. Neura keeps the
transcript and composer central, with a light conversation sidebar.

The shared stylesheet is scoped to these apps, including independently mounted
fixtures and lazy-loaded windows. Existing app styles retain layout behavior,
drawers, keyboard interaction and responsive breakpoints. The executable
terminal canvas and code blocks keep their own contrast requirements.

Verify at both desktop and narrow app-window widths. Inspect text contrast on
surfaces changed from dark to light, focus indicators, menus, scrolling, and
personal provider sign-in controls. The account and automation authorization
flows are independent of visual styling.
