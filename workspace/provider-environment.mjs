import { spawnSync } from "node:child_process";

export function agentEnvironment(environment) {
  const result = { ...environment };
  // Audio keeps its server-only key. Text agents must resolve their native
  // credential store and explicit auth order, never an ambient API fallback.
  delete result.OPENAI_API_KEY;
  // The Twilio token exists only for the trusted Gateway channel process.
  // Never place it in agent, terminal, or workspace MCP subprocesses.
  delete result.NEURAL_LABS_TWILIO_AUTH_TOKEN;
  return result;
}

export function importWorkspaceApiKey(environment = process.env, execute = spawnSync) {
  const key = environment.OPENAI_API_KEY?.trim();
  if (!key) return false;
  const result = execute("openclaw", ["models", "auth", "paste-api-key", "--agent", "main", "--provider", "openai", "--profile-id", "openai:neural-labs-workspace-api"], {
    env: environment, input: `${key}\n`, encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error("The workspace API key could not be imported into the native credential store");
  return true;
}
