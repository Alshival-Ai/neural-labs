// Preserve the shared workspace's session-tool boundary across upstream releases.
// Team collaboration goes through Neural Labs' channel-scoped MCP, not ordinary
// cross-agent session access or upstream Swarm.
export function gatewayIsolationOperations() {
  return [
    { path: "tools.sessions.visibility", value: "tree" },
    { path: "tools.agentToAgent.enabled", value: false },
    { path: "tools.swarm.enabled", value: false },
  ];
}
