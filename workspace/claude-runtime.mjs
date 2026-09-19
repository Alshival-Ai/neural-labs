import path from "node:path";
import { readFile, realpath } from "node:fs/promises";

export const CLAUDE_VERSION = "2.1.226";
export const CLAUDE_RUNTIME = "neural-labs-claude";
export const CLAUDE_CLEAR_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR", "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR", "CLAUDE_CONFIG_DIR", "ANTHROPIC_PROFILE", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"];
export function claudeEnvironment(home, environment = process.env) {
  const env = { ...environment };
  for (const name of CLAUDE_CLEAR_ENV) delete env[name];
  delete env.OPENAI_API_KEY;
  delete env.OPENCLAW_GATEWAY_PASSWORD;
  delete env.NEURAL_LABS_TWILIO_AUTH_TOKEN;
  return { ...env, CLAUDE_CONFIG_DIR: home, DISABLE_AUTOUPDATER: "1", NO_COLOR: "1" };
}
export function claudePaths(stateRoot, agentId) {
  if (!/^(main|nl-[a-z0-9]+)$/.test(agentId)) throw new Error("Invalid Claude credential owner");
  const root = path.join(stateRoot, "agents", agentId, "agent", "neural-labs-claude");
  return { root, state: path.join(root, "connection.json") };
}
export async function readClaudeConnection(stateRoot, agentId) {
  const paths = claudePaths(stateRoot, agentId);
  let state;
  try { state = JSON.parse(await readFile(paths.state, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return { paused: true, method: "subscription", generation: 0 }; throw new Error("Claude connection state is unreadable"); }
  if (!Number.isSafeInteger(state.generation) || state.generation < 0 || typeof state.paused !== "boolean" || !["subscription", "api-key"].includes(state.method)) throw new Error("Invalid Claude connection state");
  return state;
}
export async function prepareClaudeExecution(context, { stateRoot = process.env.OPENCLAW_STATE_DIR || "/home/node/.openclaw", readApiKey } = {}) {
  // The runtime receives the owner from OpenClaw, never from browser input or cwd.
  const actual = await realpath(context.agentDir || "/nonexistent").catch(() => "");
  let id = path.basename(path.dirname(context.agentDir || ""));
  let expected = /^(main|nl-[a-z0-9]+)$/.test(id) ? path.dirname(claudePaths(stateRoot, id).root) : "";
  if (!actual || actual !== await realpath(expected || "/nonexistent").catch(() => "")) {
    // Isolated Team/automation execution uses the server-authored system agent
    // binding. Never infer an owner from a shared working directory.
    id = context.config?.plugins?.entries?.[CLAUDE_RUNTIME]?.config?.credentialOwner;
    if (id !== context.config?.agents?.defaults?.systemAgent?.agentId) throw new Error("Claude isolated execution has no owner binding");
    expected = path.dirname(claudePaths(stateRoot, id).root);
    if (context.config?.agents?.entries?.[id]?.agentDir !== expected) throw new Error("Claude runtime has no verified credential owner");
  }
  const paths = claudePaths(stateRoot, id);
  const state = await readClaudeConnection(stateRoot, id);
  if (state.paused) throw new Error("Connect or resume the selected Claude connection in Model Provider settings");
  const home = path.join(paths.root, `home-${state.generation}`);
  const env = { CLAUDE_CONFIG_DIR: home, DISABLE_AUTOUPDATER: "1", ...(context.thinkingLevel === "off" ? { MAX_THINKING_TOKENS: "0" } : {}) };
  if (state.method === "api-key") {
    const key = await readApiKey?.(expected, `anthropic:neural-labs-${id}`);
    if (typeof key !== "string" || !key) throw new Error("The selected workspace Claude API key is unavailable");
    env.ANTHROPIC_API_KEY = key;
  }
  return { env, clearEnv: CLAUDE_CLEAR_ENV.filter(name => name !== "CLAUDE_CONFIG_DIR" && !(state.method === "api-key" && name === "ANTHROPIC_API_KEY")), beforeExecution: async () => {
    const current = await readClaudeConnection(stateRoot, id);
    if (current.paused || current.generation !== state.generation || current.method !== state.method) throw new Error("Claude connection changed before execution");
  } };
}
export function parseClaudeEvent(line) {
  let row;
  try { row = JSON.parse(line); } catch { return null; }
  if (row.type === "stream_event" && row.event?.type === "content_block_delta") {
    const delta = row.event.delta;
    if (delta?.type === "text_delta") return { kind: "text", text: delta.text };
    if (delta?.type === "thinking_delta") return { kind: "thinking", text: delta.thinking };
  }
  if (row.type === "system" && typeof row.session_id === "string") return { kind: "sessionId", sessionId: row.session_id };
  if (row.type === "result") return { kind: "result", text: row.result, sessionId: row.session_id,
    ...(row.is_error ? { errorText: "Claude could not complete the request. Check the selected connection and usage limits." } : {}),
    usage: { input: row.usage?.input_tokens, output: row.usage?.output_tokens, cacheRead: row.usage?.cache_read_input_tokens, cacheWrite: row.usage?.cache_creation_input_tokens } };
  return null;
}
export function buildClaudeBackend(options = {}) {
  // All tools use the Gateway MCP bridge and its existing authorization. No
  // second, unsupervised native tool execution surface is introduced.
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--tools", "", "--allowedTools", "mcp__openclaw__*", "--setting-sources", ""];
  return { id: CLAUDE_RUNTIME, modelProvider: "anthropic", bundleMcp: true, bundleMcpMode: "claude-config-file", nativeToolMode: "none", sideQuestionToolMode: "disabled", autoSelectAuthProfile: false,
    runtimeArtifact: { kind: "bundled-package-tree", packageName: "@anthropic-ai/claude-code", entrypoint: "command", nativeExecutableNames: ["claude"] },
    config: { command: "claude", args, resumeArgs: [...args, "--resume", "{sessionId}"], output: "jsonl", input: "stdin", modelArg: "--model", sessionArgs: ["--session-id", "{sessionId}"], sessionMode: "always", sessionIdFields: ["session_id"], systemPromptFileArg: "--append-system-prompt-file", systemPromptWhen: "always", serialize: true },
    prepareExecution: context => prepareClaudeExecution(context, options),
    resolveExecutionArgs: context => [...context.baseArgs, "--effort", ["minimal", "low"].includes(context.thinkingLevel) ? "low" : ["high", "xhigh", "max"].includes(context.thinkingLevel) ? context.thinkingLevel : "medium"],
    parseJsonlEvent: parseClaudeEvent };
}
