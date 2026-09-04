import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SECRET_ASSIGNMENT = /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|password|passwd|secret|authorization)\b(\s*[:=]\s*)([^\s,;]+)/giu;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+/giu;
const OPENAI_KEY = /\bsk-[A-Za-z0-9_-]{12,}\b/gu;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function safeText(value, limit) {
  return (typeof value === "string" ? value : "")
    .replace(BEARER, "Bearer [redacted]")
    .replace(OPENAI_KEY, "[redacted]")
    .replace(SECRET_ASSIGNMENT, (_match, name, separator) => `${name}${separator}[redacted]`)
    .trim()
    .slice(0, limit);
}

function nestedText(value, limit) {
  if (typeof value === "string") return safeText(value, limit);
  if (Array.isArray(value)) return safeText(value.map((item) => nestedText(item, limit)).filter(Boolean).join("\n"), limit);
  const row = record(value);
  return row ? nestedText(row.output ?? row.text ?? row.content ?? row.message, limit) : "";
}

function argumentsFor(value) {
  for (const input of [value?.args, value?.arguments, value?.input]) {
    if (record(input)) return input;
    if (typeof input === "string") {
      try {
        const parsed = JSON.parse(input);
        if (record(parsed)) return parsed;
      } catch {
        // Plain arguments are intentionally omitted from structured activity.
      }
    }
  }
  return {};
}

function activityForTool(value, fallbackId, fallbackName) {
  const args = argumentsFor(value);
  const id = safeText(value?.toolCallId ?? value?.tool_call_id ?? value?.callId ?? value?.id ?? fallbackId, 200);
  if (!id) return undefined;
  const name = safeText(value?.name ?? value?.toolName ?? value?.tool_name ?? fallbackName ?? "tool", 200).toLowerCase();
  const commandValue = args.command ?? args.cmd;
  const command = safeText(Array.isArray(commandValue) ? commandValue.map(String).join(" ") : commandValue, 4_000);
  const output = nestedText(value?.output ?? value?.content ?? value?.result, 12_000);
  const detail = safeText(value?.summary ?? value?.detail ?? value?.toolErrorSummary, 2_400);
  const path = safeText(args.path ?? args.filePath ?? args.file, 600);
  const failed = value?.isError === true || ["error", "failed", "failure"].includes(String(value?.status ?? value?.state ?? "").toLowerCase());
  const isPlan = name.includes("plan");
  const isCommand = Boolean(command) || /(^|[._-])(exec|bash|shell|command|terminal)([._-]|$)/u.test(name);
  const isFile = /(apply.?patch|write.?file|edit.?file|create.?file)/u.test(name);
  const readableName = name.replace(/^mcp__/u, "").replaceAll(/[._-]+/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
  return {
    kind: isPlan ? "plan" : isCommand ? "command" : isFile ? "file" : "tool",
    title: isPlan ? "Plan updated" : isCommand ? failed ? "Command failed" : "Command completed" : isFile ? failed ? "File update failed" : "Files updated" : readableName || "Agent action",
    ...(command ? { command } : {}),
    ...(output ? { output } : {}),
    ...(detail ? { detail } : {}),
    ...(path ? { path } : {}),
    ...(Number.isFinite(value?.exitCode) ? { exitCode: value.exitCode } : {}),
    ...(Number.isFinite(value?.durationMs) ? { durationMs: value.durationMs } : {}),
    state: failed ? "error" : "done",
    _id: id,
  };
}

function blockType(value) {
  return safeText(record(value)?.type, 50).toLowerCase().replaceAll(/[_-]+/gu, "");
}

export function activitiesFromHistory(rows) {
  const activities = [];
  const calls = new Map();
  let sawReasoning = false;
  const merge = (activity) => {
    if (!activity) return;
    const id = activity._id;
    const index = activities.findIndex((item) => item._id === id);
    activities[index >= 0 ? index : activities.length] = index >= 0 ? { ...activities[index], ...activity } : activity;
  };
  for (const candidate of Array.isArray(rows) ? rows : []) {
    const row = record(candidate);
    if (!row) continue;
    const nested = record(row.message) ?? row;
    const role = safeText(row.role ?? nested.role, 30).toLowerCase().replaceAll(/[_-]+/gu, "");
    const blocks = Array.isArray(nested.content) ? nested.content : [];
    for (const block of blocks) {
      const item = record(block);
      if (!item) continue;
      const type = blockType(item);
      if (["thinking", "reasoning"].includes(type)) sawReasoning = true;
      if (["toolcall", "tooluse", "functioncall"].includes(type)) {
        const id = safeText(item.toolCallId ?? item.tool_call_id ?? item.callId ?? item.id, 200);
        const name = safeText(item.name ?? item.toolName ?? item.tool_name, 200) || "tool";
        if (id) calls.set(id, name);
        merge(activityForTool(item, id, name));
      }
      if (["toolresult", "tooloutput", "functionresult"].includes(type)) {
        const id = safeText(item.toolCallId ?? item.tool_call_id ?? item.callId ?? item.id, 200);
        merge(activityForTool({ ...item, status: item.isError ? "error" : "completed" }, id, calls.get(id)));
      }
    }
    if (["tool", "toolresult", "function"].includes(role) && blocks.length === 0) {
      const id = safeText(row.toolCallId ?? row.tool_call_id ?? row.callId ?? row.id, 200);
      merge(activityForTool({ ...row, output: row.content, status: row.isError ? "error" : "completed" }, id, calls.get(id)));
    }
  }
  const publicActivities = activities.slice(-79).map(({ _id: _omitted, ...activity }) => activity);
  return sawReasoning
    ? [{ kind: "thinking", title: "Reasoned through the request", detail: "Neura worked through the shared context before responding.", state: "done" }, ...publicActivities]
    : publicActivities;
}

function finalText(payload) {
  for (const candidate of [payload, payload?.result]) {
    if (typeof candidate?.final === "string" && candidate.final.trim()) return candidate.final.trim();
    if (Array.isArray(candidate?.payloads)) {
      const text = candidate.payloads.map((item) => typeof item?.text === "string" ? item.text.trim() : "").filter(Boolean).join("\n\n");
      if (text) return text;
    }
  }
  throw new Error("OpenClaw returned no final assistant message");
}

function openClawConfigPath() {
  const configured = process.env.OPENCLAW_CONFIG_PATH?.trim();
  if (configured) return configured;
  const stateDirectory = process.env.OPENCLAW_STATE_DIR?.trim();
  if (stateDirectory) return path.join(stateDirectory, "openclaw.json");
  const home = process.env.HOME?.trim();
  if (!home) throw new Error("The OpenClaw configuration path is unavailable");
  return path.join(home, ".openclaw", "openclaw.json");
}

export function personalAgentExecConfig(value, agentId) {
  const source = record(value);
  const agents = record(source?.agents);
  const entries = record(agents?.entries);
  if (!record(entries?.[agentId])) throw new Error("The Team Chat personal agent is not provisioned");
  const defaults = record(agents?.defaults) ?? {};
  const systemAgent = record(defaults.systemAgent) ?? {};
  return {
    ...source,
    agents: {
      ...agents,
      defaults: {
        ...defaults,
        systemAgent: { ...systemAgent, agentId },
      },
    },
  };
}

async function loadOpenClawConfig() {
  const raw = await readFile(openClawConfigPath(), "utf8");
  return JSON.parse(raw);
}

export function activitiesFromExecSummary(value) {
  const summary = record(value);
  const calls = Number.isInteger(summary?.calls) && summary.calls > 0 ? summary.calls : 0;
  if (!calls) return [];
  const tools = Array.isArray(summary.tools)
    ? summary.tools.map((tool) => safeText(tool, 120)).filter(Boolean).slice(0, 20)
    : [];
  const failures = Number.isInteger(summary.failures) && summary.failures > 0 ? summary.failures : 0;
  const toolLabel = tools.length ? ` Tools: ${tools.join(", ")}.` : "";
  return [{
    kind: "operation",
    title: failures ? "Shared work completed with errors" : "Shared work completed",
    detail: `${calls} tool ${calls === 1 ? "call" : "calls"}.${toolLabel}`,
    state: failures ? "error" : "done",
  }];
}

export async function runTeamAgent({ prompt, capability, agentId, runId, workspaceRoot, execute = execFileAsync, loadConfig = loadOpenClawConfig }) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 1024 * 1024) throw new Error("The Team Chat prompt is invalid");
  if (typeof capability !== "string" || capability.length < 32 || capability.length > 512) throw new Error("The Team Chat capability is invalid");
  if (typeof agentId !== "string" || !/^nl-[a-z0-9]{1,60}$/u.test(agentId)) throw new Error("The Team Chat personal agent is invalid");
  if (typeof runId !== "string" || !/^[a-zA-Z0-9-]{8,128}$/u.test(runId)) throw new Error("The Team Chat run id is invalid");
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "neural-labs-team-"));
  const messagePath = path.join(temporaryDirectory, "message.md");
  const configPath = path.join(temporaryDirectory, "openclaw.json");
  let stdout;
  try {
    await writeFile(messagePath, prompt, { encoding: "utf8", mode: 0o600 });
    const config = personalAgentExecConfig(await loadConfig(agentId), agentId);
    await writeFile(configPath, JSON.stringify(config), { encoding: "utf8", mode: 0o600 });
    ({ stdout } = await execute("openclaw", [
      "agent", "exec", "--config", configPath, "--message-file", messagePath, "--cwd", workspaceRoot, "--json", "--timeout", "600",
    ], {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 10 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, NEURAL_LABS_TEAM_CAPABILITY: capability },
    }));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  const payload = JSON.parse(stdout);
  if (payload?.ok === false) throw new Error(safeText(payload?.error?.message, 500) || "OpenClaw could not complete the Team Chat turn");
  return { reply: finalText(payload), activities: activitiesFromExecSummary(payload?.toolSummary) };
}
