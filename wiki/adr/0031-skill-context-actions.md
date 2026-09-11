# ADR 0031: Authorized saved-item context actions

Status: Accepted

Skills now support immediate package duplication and confirmed deletion from the
desktop. The workspace service authenticates the forwarded actor and checks the
public origin for POST and DELETE requests. UI visibility is not authorization.

A skill owner may delete their package. Administrators may also delete a direct
child of the writable Team skill root, including operator-installed packages
without app ownership metadata. Administrators gain no deletion permission over
another user's personal package through this API. Bundled, plugin, and other
instruction roots are readable copy sources only; they are not deletion roots.
Directory identity, real paths, symlinks, package size and allowed file paths are
validated before filesystem operations. Shared mounts remain read-only.

Copies have new personal ownership; scripts, references, and assets are copied
without runtime caches or original ownership metadata. No credentials or tenant
state become repository content. Automation actions retain the existing admin
scheduler connection. Copies are paused and do not inherit subscriptions or runs.
Draft copies use existing access checks and reset publication and collaborators.

Administrators may edit existing Team packages in place through direct save and
builder publication. The API supplies edit permission and checks it on publish.
Installed packages in the writable Team root gain metadata on their first edit.
Edits retain their key, scope, and ownership. Scope changes remain owner-only.
Administrators cannot edit other users' personal skills. Bundled and plugin
instruction roots remain read-only.
