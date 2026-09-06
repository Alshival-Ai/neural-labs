# ADR 0021: Recoverable Files operations and isolated image editing

Status: Accepted for implementation; deployment requires operator promotion.

## Context

Files is a mutually trusted shared workspace, not a per-user storage product.
Desktop-style navigation and personal shortcuts should not imply isolation of
the underlying content. Deletion must be recoverable, and image editing must
not let third-party editor code inherit authenticated desktop privileges.

## Decision

Use a single Explorer listing. Persist personal pins and opened-file history
under a hashed immutable user ID outside the browsable workspace. Use revision
checks for shortcut updates and version checks for binary saves. Share Trash
among approved members with original paths, attribution, and 90-day expiry.

Serialize server file jobs, record per-item outcomes, stage copies/uploads,
journal moves and Trash transitions, and recover interrupted state at startup.
Keep successful operations committed if later items fail. Never replay an
interrupted operation without user review. Archive capabilities and job status
are user-scoped; SSE metadata invalidations are sent only to their owner.
These JSON journals provide process-interruption recovery, not transactional
multi-file snapshots or guarantees against arbitrary external filesystem races.

Vendor miniPaint at a fixed source revision with its MIT license and lockfile.
Serve only its bundled code/assets through a public nginx path that strips
credentials. Run its HTML in a CSP/iframe sandbox with scripts but without
same-origin privileges. Deny remote connections, frames, forms, popups, and
top-level navigation. Transfer one MessageChannel to the exact child window;
only the authenticated parent fetches images or writes workspace content.
Allow bounded embedded raster/project imports, not URLs or remote fonts.

All Files mutation endpoints continue requiring the trusted forwarded identity
and exact configured Origin. Keep root/traversal/symlink validation at the
filesystem boundary. Do not give the editor access to a token, cookie, host
filesystem, another user's metadata, or arbitrary proxy capability.

## Consequences

The editor's external integrations are unavailable. Layered projects use
`.minipaint.json`; raster exports flatten layers. Stale image saves preserve
edits and require a new path/reload rather than silent last-writer-wins.
Trash consumes disk and requires retention cleanup and backups. Recovery state
and workspace must share a filesystem for atomic renames. Multi-user conflicts
remain possible with direct shell writers: this is a trusted collaborative
filesystem, not a replacement for version control or isolated tenant storage.
