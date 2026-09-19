import { CLAUDE_CLEAR_ENV } from "./claude-runtime.mjs";
import { spawnSync } from "node:child_process";

export function agentEnvironment(environment) {
  const result = { ...environment };
  // Audio keeps its server-only key. Text agents must resolve their native
  // credential store and explicit auth order, never an ambient API fallback.
  delete result.OPENAI_API_KEY;
  for (const name of CLAUDE_CLEAR_ENV) delete result[name];
  // The Twilio token exists only for the trusted Gateway channel process.
  // Never place it in agent, terminal, or workspace MCP subprocesses.
  delete result.NEURAL_LABS_TWILIO_AUTH_TOKEN;
  return result;
}

export function retireWorkspaceApiKey(environment = process.env, execute = spawnSync) {
  // Earlier releases persisted the audio key in main's native auth store.
  // Removing the environment variable alone does not retire that fallback.
  const options = {
    env: agentEnvironment(environment), encoding: "utf8", timeout: 120_000,
    maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  };
  const listed = execute("openclaw", ["models", "auth", "list", "--agent", "main", "--provider", "openai", "--json"], options);
  if (listed.status !== 0) throw new Error("Could not inspect retired workspace text credentials");
  let profiles;
  try { profiles = JSON.parse(listed.stdout).profiles; } catch {}
  if (!Array.isArray(profiles)) throw new Error("Could not inspect retired workspace text credentials");
  const profileId = "openai:neural-labs-workspace-api";
  if (!profiles.some((profile) => profile.id === profileId)) return false;
  const result = execute("openclaw", ["models", "auth", "logout", "--agent", "main", "--yes", profileId], options);
  if (result.status !== 0) throw new Error("Could not retire the workspace API key from text authentication");
  return true;
}
