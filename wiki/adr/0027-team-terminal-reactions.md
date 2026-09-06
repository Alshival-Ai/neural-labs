# ADR 0027: Team Terminal GIF reactions and browser media access

- Status: Accepted
- Date: 2026-09-06

## Context

Team Terminal reactions previously accepted eight emoji through the existing
terminal socket. A full emoji catalog and KLIPY GIF picker require catalog access
and browser image loading while preserving the terminal's input and access model.

## Decision

Bundle the same pinned Emoji Mart native dataset in the desktop and workspace
runtime. The runtime accepts only native sequences from that dataset, including
skin-tone variants. Emoji assets and search metadata load locally.

Extract the existing KLIPY request code into a reusable MCP-build client and
inject it into the workspace server at startup. Credentials remain server-side.
The authenticated terminal-scoped GIF catalog rechecks Team access after the
provider request. Queries are limited to 160 characters; responses have a 2MiB
streamed limit and a 15-second timeout. API redirects are rejected. The terminal
picker explicitly requests `contentfilter=off` and preserves result ordering.

Each catalog selection receives a random token bound to the requesting actor and
terminal. Tokens expire in ten minutes; the in-memory cache holds at most 2,000
selections and is periodically cleaned. Every send verifies current Team access,
selection scope/expiry, and sender cooldown before broadcasting. The broadcast
contains provider metadata, not the selection token. Emoji keeps its prior socket
shape; GIF adds `kind: "gif"` and `gif` metadata. Rejections use `reaction-error`.

The desktop CSP now permits HTTPS image loading from `static.klipy.com`,
`static1.klipy.com`, and `static2.klipy.com`. Both the provider adapter and browser
validate these exact hosts, reject URL credentials/nonstandard ports, and use
`no-referrer` for images. Script, connection, and frame policies are unchanged.
There is no general URL fetch proxy or arbitrary-URL reaction input.

## Consequences

- GIF viewers contact KLIPY media hosts directly; those hosts see normal image
  request network information. Provider API credentials never reach browsers.
- Reactions reach connected participants in the same terminal and are ephemeral;
  they do not enter PTY input/output, saved messages, or reconnect replay.
- GIF catalog/share operations fail independently of terminal input and emoji.
- Reduced-motion viewers receive still previews, or text if no still exists.
- Restarting the workspace discards selection tokens. An expired selection
  prompts the user to search again. No database migration is required.

Provider references: [KLIPY API](https://docs.klipy.com/) and
[Emoji Mart](https://github.com/missive/emoji-mart).
