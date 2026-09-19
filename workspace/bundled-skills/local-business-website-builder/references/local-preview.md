# Local Preview

Use this reference after implementation or when the user asks to see the result locally.

## Start safely

1. Inspect the project's package scripts, framework instructions, lockfile, and existing terminal or server state.
2. Use the repository's supported development command. Prefer port `3000` when it is free or when the current project is already serving there.
3. Do not terminate an unrelated process to obtain port `3000`. Reuse the existing project server when appropriate; otherwise choose an available port and report the actual URL.
4. Wait for a successful ready signal and load the intended route, not merely the server root.

## Browser review

- Open the local page in a real browser when available.
- Review desktop and mobile widths, navigation, primary conversion, missing assets, fonts, effects, reduced motion, keyboard behavior, layout stability, and refresh state.
- Inspect console errors and failed network requests.
- Exercise forward and reverse input for cinematic sections and confirm native scrolling remains usable.
- Capture or report the exact route reviewed and any visible mismatch between the brief and implementation.

## Completion

Leave the server running only when that matches the user's current workflow. Report the command, actual local URL, route, build or runtime status, and remaining blockers. Do not describe `localhost:3000` as ready unless the intended page was actually loaded there.
