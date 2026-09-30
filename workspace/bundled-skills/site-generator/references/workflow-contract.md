# Website project and delivery contract

## Project identity and artifacts

Use the user's existing project or a new unused directory relative to the current
workspace. Do not require a Place ID, city, hostname or reservation registry.
Use a supplied business identity or URL when relevant; preserve uncertainty rather
than inventing identifiers. Resume existing files without rewriting historical QA
or release evidence. Respect a request to revise an existing site.

For substantial work keep DESIGN.md, optional STORYBOARD.md, SOURCES.md, MEDIA.json
and VALIDATION.md beside the source, outside the public output. Small sites may use
one concise note. Business builds can use the builder's
[quality contract](../../local-business-website-builder/references/quality-contract.md).
A media record identifies its source, local derivative, role, usage basis,
authentic/representative status and attribution. Do not save secrets or signed
asset URLs. Only record evidence from checks actually performed.

Use the repository's build output (`dist/`, `site/`, or its established equivalent).
Framework projects retain their own build and validation commands. Do not replace
an existing application with a static HTML scaffold.

## Local checks and preview

Run the project's focused checks and production build. For static output, run:

```text
node <site-generator-directory>/scripts/check-site.mjs <public-output-directory>
```

The helper checks for index.html, unsafe file types, links and accidentally copied
private/project files. It reads only the given tree and creates no server or
release. Its JSON result is a structural check, not browser or content approval.
It cannot detect secrets embedded in otherwise public source; inspect the intended
output before publication. Server apps use their framework's production checks.

For browser review, use a project preview server bound to loopback on an available
port and the runtime's browser/preview capability. Preserve unrelated processes.
Report the actual returned preview route; a localhost address refers to the
installation's machine, not a remote user's computer. Do not publish merely to
obtain a preview. Verify responsive layout, real controls, console/network errors,
keyboard access and selected interaction fallbacks. Do not manufacture a passing
BUILD-RESULT.json or claim that structural checks prove artistic quality.

## Requested deployment

Load `$deploy`. Read `hosting`, then deploy the intended output with the current
`deployments` tool. The service owns names, build limits, routing, persistence and
TLS. Do not impose a historical publisher's size/CSP limits or reserve a hostname
in a separate registry. Local installations default to local URLs; configured
public hosting returns its own domain. If configured public hosting is unavailable,
report that failure instead of inventing a successful public URL.

Keep a concept's demo disclosure and non-submitting forms when applicable; do not
label an authorized production site a prospect concept. Production claims and
integrations need their actual supporting evidence. Inspect the returned site
under its real delivery headers. On timeout inspect deployment status before
retrying. Report source, preview/public URL, deployment identity, checks and gaps.
