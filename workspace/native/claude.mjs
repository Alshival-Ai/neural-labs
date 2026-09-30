import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";

export const CLAUDE_PROTOCOL_VERSION = "2.1.226";

export function claudeArguments({ model, nativeSession, sessionId, policy, mcpConfig, effort }) {
  if (!model || typeof model !== "string" || !/^[a-f0-9-]{36}$/i.test(nativeSession || sessionId || "")) throw new Error("Explicit Claude model and session are required");
  if (!["read-only", "workspace-write"].includes(policy?.sandbox) || policy.approval !== "on-request") throw new Error("Unreviewed Claude execution policy");
  if (effort !== undefined && !["low", "medium", "high", "xhigh", "max"].includes(effort)) throw new Error("Unsupported Claude reasoning effort");
  return ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--permission-prompt-tool", "stdio", "--permission-mode", "default", "--setting-sources", "", "--strict-mcp-config",
    "--tools", policy.sandbox === "read-only" ? "Read,Glob,Grep" : "Read,Glob,Grep,Edit,Write,Bash",
    ...(mcpConfig ? ["--mcp-config", mcpConfig] : []), "--model", model,
    ...(effort ? ["--effort", effort] : []),
    ...(nativeSession ? ["--resume", nativeSession] : ["--session-id", sessionId])];
}

// The structured host protocol is pinned and initialization-probed separately
// from the terminal CLI. Native tools stay container-local; provider stdin is
// never connected to a browser. The runtime mediates every permission request.
export async function runClaudeTurn({ command = "/usr/local/bin/claude", version = CLAUDE_PROTOCOL_VERSION,
  cwd, env, model, input, nativeSession, policy = { sandbox: "workspace-write", approval: "on-request" },
  mcpConfig, effort, background = false, mediatedBrowser = false, revalidate, onSession, onEvent, approve, signal,
  timeoutMs = 20 * 60_000, leaseCheckMs = 5000, executeVersion = promisify(execFile), spawnProcess = spawn,
}) {
  if (!path.isAbsolute(cwd) || !Array.isArray(input) || !input.length
      || input.some(item => item?.type !== "text" || typeof item.text !== "string")
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(leaseCheckMs) || leaseCheckMs < 1 || leaseCheckMs > 10000) throw new Error("Invalid Claude execution context");
  if (![revalidate, onSession, onEvent].every(value => typeof value === "function")) throw new Error("Claude execution requires lease and persistence callbacks");
  const sessionId = nativeSession || randomUUID();
  const args = claudeArguments({ model, nativeSession, sessionId, policy, mcpConfig, effort });
  if (signal?.aborted) return { status: "cancelled" };
  await revalidate();
  const actual = await executeVersion(command, ["--version"], { cwd, env, timeout: 10000, maxBuffer: 65536 });
  if (!actual.stdout.trim().startsWith(`${version} `) || version !== CLAUDE_PROTOCOL_VERSION) throw new Error("Claude executable does not match the reviewed pin");
  await revalidate();
  if (signal?.aborted) return { status: "cancelled" };
  let lastOutputValidation = Date.now();
  const child = spawnProcess(command, args, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  let resolveDone, settled = false, buffer = "", eventTail = Promise.resolve(), initialized = false;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const finish = outcome => { if (settled) return; settled = true; resolveDone(outcome); };
  const send = message => { if (!settled) child.stdin.write(JSON.stringify(message) + "\n"); };
  const interrupt = () => send({ type: "control_request", request_id: randomUUID(), request: { subtype: "interrupt" } });
  const abort = () => { interrupt(); finish({ status: "cancelled" }); };
  const timer = setTimeout(() => { interrupt(); finish({ status: "unknown", code: "provider-timeout" }); }, timeoutMs);
  let checking = false;
  const leaseTimer = setInterval(() => {
    if (settled || checking) return;
    checking = true;
    Promise.resolve().then(revalidate).catch(() => {
      interrupt(); finish({ status: "unknown", code: "execution-lease-revoked" });
    }).finally(() => { checking = false; });
  }, leaseCheckMs);
  signal?.addEventListener("abort", abort, { once: true });
  child.stderr.resume();
  child.once("error", () => finish({ status: "unknown", code: "provider-start-failed" }));
  child.stdin.on("error", () => finish({ status: "unknown", code: "provider-input-closed" }));
  child.once("exit", () => { void eventTail.finally(() => finish({ status: "unknown", code: "provider-disconnected" })); });

  function message(row) {
    if (row.type === "control_request") {
      void (async () => {
        if (!initialized || typeof row.request_id !== "string" || row.request?.subtype !== "can_use_tool") throw new Error("Unsupported Claude control request");
        await revalidate();
        // Only the runtime-owned browser adapter delegates action approval to
        // its broker. This is not a general MCP or CLI permission bypass.
        if (mediatedBrowser && mcpConfig && row.request.tool_name === 'mcp__neural-labs__browser') {
          send({ type: 'control_response', response: { subtype: 'success', request_id: row.request_id,
            response: { behavior: 'allow', updatedInput: row.request.input } } });
          return;
        }
        if (background) {
          await onEvent("blocked", { code: "approval-required", tool: row.request.tool_name });
          interrupt(); finish({ status: "blocked", code: "approval-required" }); return;
        }
        if (typeof approve !== "function") throw new Error("Approval UI is unavailable");
        const decision = await Promise.race([
          approve({ id: row.request_id, method: "tool/permission", params: row.request }), done.then(() => null),
        ]);
        if (settled || decision === null) return;
        await revalidate();
        if (!["accept", "decline", "cancel"].includes(decision?.decision)) throw new Error("Invalid native approval decision");
        send({ type: "control_response", response: { subtype: "success", request_id: row.request_id,
          response: decision.decision === "accept" ? { behavior: "allow", updatedInput: row.request.input }
            : { behavior: "deny", message: "Permission was not granted by the workspace user", interrupt: decision.decision === "cancel" } } });
      })().catch(() => { interrupt(); finish({ status: "unknown", code: "approval-or-lease-failed" }); });
      return;
    }
    eventTail = eventTail.then(async () => {
      if (settled) return;
      if (row.type === "control_response" && row.response?.request_id === "initialize-1") {
        if (initialized || row.response.subtype !== "success") throw new Error("Claude initialization failed");
        await onSession(sessionId);
        await revalidate();
        initialized = true;
        send({ type: "user", session_id: sessionId, message: { role: "user", content: input } });
        return;
      }
      if (!initialized) return;
      if (row.session_id && row.session_id !== sessionId) throw new Error("Claude session identity mismatch");
      const textDelta = row.type === "stream_event" && row.event?.type === "content_block_delta" && row.event.delta?.type === "text_delta";
      // The lease timer and control requests keep checking authority. Avoid a
      // control-plane round trip for every tiny text fragment while bounding
      // stream revocation latency to a short window.
      if (!textDelta || Date.now() - lastOutputValidation >= 250) {
        await revalidate();
        lastOutputValidation = Date.now();
      }
      if (textDelta) {
        await onEvent("output", { text: row.event.delta.text });
      } else if (["assistant", "user", "tool_progress"].includes(row.type)) {
        await onEvent(row.type === "tool_progress" ? "tool-output" : "item-completed", row);
      } else if (row.type === "result") {
        await onEvent("result", row);
        finish({ status: row.is_error ? "failed" : "succeeded", nativeSession: sessionId });
      }
    }).catch(() => { interrupt(); finish({ status: "unknown", code: "event-or-protocol-failed" }); });
  }
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    if (settled) return;
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) { finish({ status: "unknown", code: "provider-frame-limit" }); return; }
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n"), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      let row;
      try { row = JSON.parse(line); } catch { finish({ status: "unknown", code: "provider-invalid-json" }); return; }
      if (!row || typeof row !== "object") { finish({ status: "unknown", code: "provider-invalid-frame" }); return; }
      message(row);
    }
  });
  try {
    send({ type: "control_request", request_id: "initialize-1", request: { subtype: "initialize" } });
    return await done;
  } finally {
    clearTimeout(timer); clearInterval(leaseTimer); signal?.removeEventListener("abort", abort);
    if (child.pid && child.exitCode === null) {
      await new Promise(resolve => {
        const killTimer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} resolve(); }, 2000);
        child.once("exit", () => { clearTimeout(killTimer); resolve(); });
        try { process.kill(-child.pid, "SIGTERM"); } catch { clearTimeout(killTimer); resolve(); }
      });
    }
    await eventTail;
  }
}
