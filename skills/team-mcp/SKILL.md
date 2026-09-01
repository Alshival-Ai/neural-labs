---
name: team-mcp
description: Use the shared Alshival team MCP service for approved internal data and automation tasks.
---

# Team MCP

Use the tools exposed by the `team` MCP server when the request requires shared Alshival data or an internal automation.

Before a write or externally visible action:

1. Confirm the exact target and intended effect.
2. Use the narrowest available tool.
3. Respect the caller's tenant-scoped authorization.
4. Report the result without exposing tokens, credentials, or unrelated records.

Never attempt to bypass a denied MCP operation, infer a broader credential, or use shell access to reach another tenant. If the service returns an authorization error, explain which capability is unavailable and ask the platform operator to review the tenant's scope.
