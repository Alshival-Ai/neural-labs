import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { ensureAuthProfileStore } from "openclaw/plugin-sdk/provider-auth";
import { buildClaudeBackend } from "../claude-runtime.mjs";
export default definePluginEntry({
  id: "neural-labs-claude", name: "Neural Labs Claude runtime", description: "Owner-scoped native Claude CLI with Gateway-authorized tools",
  register(api) { api.registerCliBackend(buildClaudeBackend({ readApiKey(agentDir, profileId) { const credential = ensureAuthProfileStore(agentDir, { readOnly: true, syncExternalCli: false }).profiles[profileId]; return credential?.type === "api_key" && credential.provider === "anthropic" ? credential.key : undefined; } })); },
});
