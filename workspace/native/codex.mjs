import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import path from "node:path";

export const CODEX_PROTOCOL_VERSION = "0.155.1";
export const CODEX_APP_SERVER = "/usr/local/lib/neural-labs/codex-app-server/node_modules/.bin/codex";

export function providerEnvironment({ provider, home, credentialHome, method, apiKey }) {
  if (!["codex", "claude"].includes(provider) || !["subscription", "api-key"].includes(method)
      || !path.isAbsolute(home) || !path.isAbsolute(credentialHome)) throw new Error("Explicit native account paths and billing method are required");
  if (method === "api-key" && (typeof apiKey !== "string" || !apiKey)) throw new Error("Selected API credential is unavailable");
  if (method === "subscription" && apiKey !== undefined) throw new Error("Subscription execution cannot inherit an API credential");
  // Deliberately build an allowlist. Never spread process.env: the control plane
  // and workspace server may have connector, database, proxy or service tokens.
  const env = { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: home, LANG: "C.UTF-8", NO_COLOR: "1" };
  if (provider === "codex") {
    env.CODEX_HOME = credentialHome;
    if (method === "api-key") env.OPENAI_API_KEY = apiKey;
  } else {
    env.CLAUDE_CONFIG_DIR = credentialHome;
    env.DISABLE_AUTOUPDATER = "1";
    if (method === "api-key") env.ANTHROPIC_API_KEY = apiKey;
  }
  return env;
}

export class StdioRpc extends EventEmitter {
  constructor(command, args, { cwd, env, spawnProcess = spawn, requestTimeoutMs = 30000 } = {}) {
    super();
    this.pending = new Map(); this.sequence = 0; this.buffer = "";
    this.requestTimeoutMs = requestTimeoutMs;
    this.child = spawnProcess(command, args, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.resume(); // Never expose raw provider diagnostics/credentials.
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", chunk => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 4 * 1024 * 1024) { this.fail(new Error("Native protocol frame exceeds its limit")); return; }
      while (this.buffer.includes("\n")) {
        const at = this.buffer.indexOf("\n"), line = this.buffer.slice(0, at); this.buffer = this.buffer.slice(at + 1);
        let message;
        try { message = JSON.parse(line); }
        catch { this.fail(new Error("Native provider emitted invalid protocol data")); return; }
        if (!message || typeof message !== "object") { this.fail(new Error("Invalid native protocol frame")); return; }
        if (message.method) this.emit("message", message);
        else if (Object.hasOwn(message, "id")) {
          const entry = this.pending.get(message.id);
          if (!entry) continue;
          clearTimeout(entry.timer); this.pending.delete(message.id);
          message.error ? entry.reject(new Error("Native provider rejected the request")) : entry.resolve(message.result);
        }
      }
    });
    this.child.once("error", () => this.fail(new Error("Native provider could not start")));
    this.child.stdin.on("error", () => this.fail(new Error("Native provider input closed")));
    this.child.once("exit", () => this.fail(new Error("Native provider disconnected")));
  }
  fail(error) {
    if (this.failure) return;
    this.failure = error;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
    this.emit("disconnected", error);
  }
  send(message) {
    if (this.failure) throw this.failure;
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  request(method, params) {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Native provider request timed out")); }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async close() {
    this.fail(new Error("Native provider closed"));
    if (!this.child.pid || this.child.exitCode !== null) return;
    await new Promise(resolve => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { try { process.kill(-this.child.pid, "SIGKILL"); } catch {} finish(); }, 2000);
      this.child.once("exit", finish);
      try { process.kill(-this.child.pid, "SIGTERM"); } catch { finish(); }
    });
  }
}

const COMMAND_APPROVAL = "item/commandExecution/requestApproval";
const FILE_APPROVAL = "item/fileChange/requestApproval";
const INPUT_REQUEST = "item/tool/requestUserInput";
const MCP_REQUEST = "mcpServer/elicitation/request";
const EVENT_TYPES = new Map([
  ["item/agentMessage/delta", "output"], ["item/started", "item-started"], ["item/completed", "item-completed"],
  ["item/commandExecution/outputDelta", "tool-output"], ["turn/plan/updated", "plan"],
  ["turn/diff/updated", "diff"], ["thread/tokenUsage/updated", "usage"], ["serverRequest/resolved", "approval-resolved"],
]);

// One short-lived app-server per active conversation turn. Persistent native
// thread IDs survive process release. Independent conversations launch without
// a shared queue. The caller owns its durable conversation lock and lease.
export async function runCodexTurn({
  command = CODEX_APP_SERVER, version = CODEX_PROTOCOL_VERSION, cwd, env, model, input, nativeSession,
  mcpConfig, effort,
  policy = { sandbox: "workspace-write", approval: "on-request" }, background = false,
  revalidate, onSession, onEvent, approve, signal, timeoutMs = 20 * 60_000, leaseCheckMs = 5000,
  executeVersion = promisify(execFile), createRpc = (...args) => new StdioRpc(...args),
}) {
  if (!["read-only", "workspace-write"].includes(policy.sandbox) || !["on-request", "never"].includes(policy.approval)) throw new Error("Unreviewed native execution policy");
  if (effort !== undefined && !["none", "minimal", "low", "medium", "high", "xhigh"].includes(effort)) throw new Error("Unsupported Codex reasoning effort");
  if (!path.isAbsolute(cwd) || typeof model !== "string" || !model.trim() || !Array.isArray(input)
      || !input.length || input.some(item => !item || !(item.type === "text" && typeof item.text === "string"
        || item.type === "skill" && typeof item.name === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(item.name) && item.path === `/opt/neural-labs/skills/${item.name}/SKILL.md`))) throw new Error("Invalid native turn input");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(leaseCheckMs) || leaseCheckMs < 1
      || leaseCheckMs > 10000 || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid provider release or timeout");
  if (typeof revalidate !== "function" || typeof onSession !== "function" || typeof onEvent !== "function") throw new Error("Native execution requires lease and persistence callbacks");
  if (signal?.aborted) return { status: "cancelled" };
  await revalidate();
  const actual = await executeVersion(command, ["--version"], { cwd, env, timeout: 10000, maxBuffer: 65536 });
  if (actual.stdout.trim() !== `codex-cli ${version}`) throw new Error("Native app-server does not match the reviewed pin");
  await revalidate();
  if (signal?.aborted) return { status: "cancelled" };
  const args = ["app-server", "-c", `forced_login_method=${JSON.stringify(env.OPENAI_API_KEY ? "api" : "chatgpt")}`];
  if (policy.approval === "never" && policy.sandbox === "workspace-write") args.push("-c", "sandbox_workspace_write.network_access=true");
  if (mcpConfig) {
    args.push("-c", "mcp_servers.neural-labs.tool_timeout_sec=420", "-c", `mcp_servers.neural-labs.url=${JSON.stringify(mcpConfig.url)}`,
      "-c", `mcp_servers.neural-labs.http_headers={${Object.entries(mcpConfig.http_headers).map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(",")}}`);
    if (mcpConfig.team) args.push("-c", `mcp_servers.neural-labs-team.url=${JSON.stringify(mcpConfig.team.url)}`,
      "-c", `mcp_servers.neural-labs-team.http_headers={${Object.entries(mcpConfig.team.http_headers).map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(",")}}`);
  }
  const rpc = createRpc(command, args, { cwd, env });
  let threadId, turnId, settled = false, result, resolveDone, eventTail = Promise.resolve();
  const done = new Promise(resolve => { resolveDone = resolve; });
  const finish = value => { if (settled) return; settled = true; result = value; resolveDone(value); };
  const interrupt = () => {
    if (threadId && turnId) void rpc.request("turn/interrupt", { threadId, turnId }).catch(() => {});
  };
  // The first terminal outcome wins. Process loss/timeouts cannot prove whether
  // a tool already took effect, so they remain unknown rather than retryable.
  const abort = () => { interrupt(); finish({ status: "cancelled" }); };
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { interrupt(); finish({ status: "unknown", code: "provider-timeout" }); }, timeoutMs);
  let checking = false;
  const leaseTimer = setInterval(() => {
    if (checking || settled) return;
    checking = true;
    Promise.resolve().then(revalidate).catch(() => {
      interrupt(); finish({ status: "unknown", code: "execution-lease-revoked" });
    }).finally(() => { checking = false; });
  }, leaseCheckMs);
  const request = (method, params) => Promise.race([
    rpc.request(method, params), done.then(() => { throw new Error("Native turn settled"); }),
  ]);
  rpc.on("disconnected", () => finish({ status: "unknown", code: "provider-disconnected" }));
  rpc.on("message", message => {
    // Responses to approval requests may wait on a human; do not block event
    // processing (including cancellation and completion) behind that promise.
    if (Object.hasOwn(message, "id")) {
      void (async () => {
        const params = message.params || {};
        if (!threadId || params.threadId !== threadId || (turnId && params.turnId && params.turnId !== turnId)) throw new Error("Provider request scope mismatch");
        await revalidate();
        if (background) {
          await onEvent("blocked", { code: "approval-required", method: message.method });
          interrupt(); finish({ status: "blocked", code: "approval-required" });
          return;
        }
        if (![COMMAND_APPROVAL, FILE_APPROVAL, INPUT_REQUEST, MCP_REQUEST].includes(message.method) || typeof approve !== "function") {
          rpc.send({ id: message.id, error: { code: -32601, message: "Unsupported provider request" } });
          return;
        }
        const schema = params.requestedSchema;
        const emptyConfirmation = message.method === MCP_REQUEST && params.mode === "form"
          && schema?.type === "object" && schema.properties && Object.keys(schema.properties).length === 0
          && (!schema.required || schema.required.length === 0);
        const approval = policy.approval === "never" && emptyConfirmation ? { action: "accept", content: {} } : await Promise.race([
          approve({ id: String(message.id), method: message.method, params }),
          done.then(() => null),
        ]);
        if (settled || approval === null) return;
        await revalidate();
        if ([COMMAND_APPROVAL, FILE_APPROVAL].includes(message.method)) {
          if (!["accept", "decline", "cancel"].includes(approval?.decision)) throw new Error("Invalid native approval decision");
          rpc.send({ id: message.id, result: { decision: approval.decision } });
        } else if (message.method === MCP_REQUEST) {
          if (!["accept", "decline", "cancel"].includes(approval?.action)) throw new Error("Invalid elicitation decision");
          rpc.send({ id: message.id, result: { action: approval.action, content: approval.content ?? null } });
        } else {
          if (!approval.answers || typeof approval.answers !== "object") throw new Error("Invalid native user input");
          rpc.send({ id: message.id, result: { answers: approval.answers } });
        }
      })().catch(() => { interrupt(); finish({ status: "unknown", code: "approval-or-lease-failed" }); });
      return;
    }
    eventTail = eventTail.then(async () => {
      if (settled) return;
      const params = message.params || {};
      if (!threadId || params.threadId !== threadId || (turnId && params.turnId && params.turnId !== turnId)) return;
      await revalidate();
      if (message.method === "turn/started" && params.turn?.id) turnId = params.turn.id;
      if (EVENT_TYPES.has(message.method)) await onEvent(EVENT_TYPES.get(message.method), params);
      if (message.method === "turn/completed") {
        const status = { completed: "succeeded", failed: "failed", interrupted: "cancelled" }[params.turn?.status] || "unknown";
        finish({ status, nativeSession: threadId });
      }
    }).catch(() => { interrupt(); finish({ status: "unknown", code: "event-or-lease-failed" }); });
  });
  try {
    await request("initialize", { clientInfo: { name: "neural_labs", title: "Neural Labs", version: "1" } });
    rpc.send({ method: "initialized" });
    if (settled) return result;
    const thread = await request(nativeSession ? "thread/resume" : "thread/start", {
      ...(nativeSession ? { threadId: nativeSession } : {}), model, modelProvider: "openai", cwd,
      approvalPolicy: policy.approval, sandbox: policy.sandbox,
    });
    threadId = thread?.thread?.id;
    if (typeof threadId !== "string" || !threadId || (nativeSession && threadId !== nativeSession)) throw new Error("Native session identity did not verify");
    await onSession(threadId);
    await revalidate();
    if (settled || signal?.aborted) return result || { status: "cancelled" };
    const started = await request("turn/start", { threadId, input, model, ...(effort ? { effort } : {}) });
    turnId = started?.turn?.id;
    if (typeof turnId !== "string" || !turnId) throw new Error("Native turn identity did not verify");
    return await done;
  } catch {
    finish({ status: "unknown", code: "provider-protocol-failed" });
    return result;
  } finally {
    clearTimeout(timer); clearInterval(leaseTimer); signal?.removeEventListener("abort", abort);
    await rpc.close();
    await eventTail;
  }
}
