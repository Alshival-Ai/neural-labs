# ADR 0026: Explicitly save chat attachments into the shared workspace

> Design history: for current instructions, see [Files desktop app](../files.md).
> See the [decision index](../maintainer-reference.md#architecture-decision-history) for amendments and related records.

- Status: Accepted
- Date: 2026-09-06

## Context

Private Neura attachments use the scoped media capabilities described in
[ADR 0018](0018-private-neura-generated-media.md). Users also need to save an
attachment into Files, where approved workspace users share access. This is an
explicit transfer from a private conversation into shared storage.

## Decision

Offer Download to Workspace only as a user action with a destination and filename
chooser. Explain the shared destination in the chooser. Previewing an attachment
or downloading it to the browser does not persist a workspace copy. Ask on name
conflicts; replacement uses the existing Files recovery behavior.

For private ticketed media, an authenticated, same-origin POST to
`/workspace/api/files/import-neura` accepts an existing outgoing-media route,
destination, filename, and optional conflict choice. It validates the same
strict route and ticket as the media relay and streams from the fixed configured
Gateway origin into the confined Files upload pipeline. It does not accept
arbitrary origins, follow redirects, forward browser credentials upstream, mint
media tickets, or read arbitrary Gateway paths. Disconnection aborts the import;
failed and oversized transfers remove staging files before replacement.

Existing workspace files use Files copy operations. Already-resolved inline
attachments use the existing upload endpoint. Each source retains its existing
authorization checks. Media tickets and temporary preview URLs are not persisted
in desktop preferences. Expired tickets may be refreshed once through the owning
user's authenticated Gateway session.

The GET/HEAD media relay additionally accepts `download=1` and an optional
filename to return attachment disposition. These display parameters are not
forwarded upstream. Downloads can carry any ticket-authorized file type; inline
responses retain their existing media-type restrictions.

## Consequences

- A successful explicit save creates a normal shared workspace file. Expiry of
  the source ticket does not revoke that user-requested copy.
- There is no new public ingress route or general-purpose URL fetch service.
- The import reuses Files limits, conflict checks, recovery, and notifications.
- Team attachment-only messages require migration 10 to permit empty text when
  attachments exist. Existing message text is preserved, including ambiguous
  filename captions; fully empty messages remain rejected.
