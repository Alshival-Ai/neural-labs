// This is a runtime capability marker, never an Anthropic bearer credential.
// Each launch resolves and checks its own agent's private Claude connection in
// prepareClaudeExecution. Only the private runtime provider receives this marker;
// canonical anthropic/openai providers never receive a bearer credential.
export const CLAUDE_NATIVE_MARKER = "neural-labs:owner-scoped-claude";
export default {
  id: "neural-labs-claude",
  label: "Private Claude CLI",
  auth: [],
  resolveSyntheticAuth({ provider }) {
    if (provider !== "neural-labs-claude") return undefined;
    return { apiKey: CLAUDE_NATIVE_MARKER, source: "Owner-scoped Claude CLI; authorization checked per run", mode: "oauth" };
  },
};
