# OpenClaw stays upstream

Neural Labs does not maintain source patches or overwrite files under `/app`.
The former native-planning patch was retired in favor of an application-owned
plan-drafting workflow using standard `chat.send` requests. The upstream
Codex runtime owns its binary, permissions, and supported collaboration modes.

Keep integrations in Neural Labs services, its MCP tools, the desktop client,
public configuration, or documented upstream extension interfaces. A request
that needs unsupported core behavior should be proposed upstream; do not add
another source overlay to the workspace image.

The release manifest retains an empty patch inventory to make that decision
visible. Release validation rejects source patches and runtime modifications.
See [ADR 0028](../../wiki/adr/0028-upstream-openclaw-boundary.md).
