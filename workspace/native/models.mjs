import { CODEX_APP_SERVER, CODEX_PROTOCOL_VERSION, StdioRpc, providerEnvironment } from "./codex.mjs";
import { CLAUDE_PROTOCOL_VERSION } from "./claude.mjs";

export async function readCodexModels(grant, env, makeRpc = (...args) => new StdioRpc(...args)) {
  const rpc = makeRpc(CODEX_APP_SERVER, ["app-server", "-c", `forced_login_method=${JSON.stringify(grant.binding.method === "api-key" ? "api" : "chatgpt")}`],
    { cwd: grant.cwd, env, spawnProcess: grant.launch.spawn, requestTimeoutMs: 10000 });
  try {
    await rpc.request("initialize", { clientInfo: { name: "neural_labs_catalog", version: "1" } });
    rpc.send({ method: "initialized" });
    const rows = [], seen = new Set(); let cursor;
    do {
      await grant.revalidate();
      const result = await rpc.request("model/list", { limit: 100, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result.data)) throw new Error("Invalid native model catalog");
      rows.push(...result.data); cursor = result.nextCursor;
      if (rows.length > 5000 || cursor && seen.has(cursor)) throw new Error("Native model pagination did not terminate");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return rows;
  } finally { await rpc.close(); }
}

// API accounts do not receive the subscription's remote Codex catalog. Use
// their own OpenAI inventory, restricted to agent-capable GPT reasoning families.
// Image, audio, embeddings, moderation and specialized safety models are excluded.
export async function readOpenAIModels(grant, fetchModels = fetch) {
  await grant.revalidate();
  const response = await fetchModels("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${grant.apiKey}` }, signal: AbortSignal.timeout(10000), redirect: "error",
  });
  if (!response.ok) throw new Error("OpenAI model inventory is unavailable");
  const payload = await response.json();
  if (!Array.isArray(payload.data) || payload.data.length > 5000) throw new Error("Invalid OpenAI model inventory");
  await grant.revalidate();
  return payload.data.filter(row => typeof row?.id === "string" &&
    /^gpt-(?:[5-9]|\d{2,})(?:\.\d+)?(?:-[a-z0-9]+)*$/.test(row.id) &&
    !/(?:^|-)(?:image|audio|realtime|transcribe|search|moderation|daybreak)(?:-|$)/.test(row.id))
    .map(row => ({ model: row.id, displayName: row.id, inputModalities: ["text"] }));
}

export async function readClaudeModels(grant, env) {
  // Initialization reports the pinned CLI's supported models and effort
  // options. Never send a user message or start inference to discover models.
  const child = grant.launch.spawn("/usr/local/bin/claude", ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--permission-prompt-tool", "stdio", "--permission-mode", "default", "--setting-sources", "", "--strict-mcp-config"],
  { cwd: grant.cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.resume();
  try {
    return await new Promise((resolve, reject) => {
      let buffer = "", settled = false;
      const finish = (error, result) => {
        if (settled) return; settled = true; clearTimeout(timer);
        error ? reject(error) : resolve(result);
      };
      const timer = setTimeout(() => finish(new Error("Native catalog initialization timed out")), 10000);
      child.once("error", () => finish(new Error("Native catalog process unavailable")));
      child.once("exit", () => finish(new Error("Native catalog process disconnected")));
      child.stdin.on("error", () => finish(new Error("Native catalog input closed")));
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => {
        if (settled) return; buffer += chunk;
        if (Buffer.byteLength(buffer) > 2 * 1024 ** 2) { finish(new Error("Native catalog frame limit")); return; }
        while (buffer.includes("\n")) {
          const index = buffer.indexOf("\n"), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          let message; try { message = JSON.parse(line); } catch { finish(new Error("Invalid native catalog protocol")); return; }
          if (message?.type === "control_response" && message.response?.request_id === "catalog-1") {
            const models = message.response.response?.models;
            if (message.response.subtype !== "success" || !Array.isArray(models)) finish(new Error("Native catalog is unavailable"));
            else finish(null, models);
          }
        }
      });
      child.stdin.write(JSON.stringify({ type: "control_request", request_id: "catalog-1", request: { subtype: "initialize" } }) + "\n");
    });
  } finally {
    if (child.pid && child.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} resolve(); }, 2000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      try { process.kill(-child.pid, "SIGTERM"); } catch { clearTimeout(timer); resolve(); }
    });
  }
}

export async function nativeModelCatalog(grant, { ready, readers = { codex: readCodexModels, claude: readClaudeModels, openai: readOpenAIModels } } = {}) {
  const provider = grant.binding.provider;
  const env = providerEnvironment({ provider, home: grant.home, credentialHome: grant.credentialHome, method: grant.binding.method,
    ...(grant.apiKey ? { apiKey: grant.apiKey } : {}) });
  await grant.revalidate();
  const command = provider === "codex" ? CODEX_APP_SERVER : "/usr/local/bin/claude";
  const version = provider === "codex" ? CODEX_PROTOCOL_VERSION : CLAUDE_PROTOCOL_VERSION;
  const actual = await grant.launch.exec(command, ["--version"], { env, cwd: grant.cwd, timeout: 10000, maxBuffer: 65536 });
  if (provider === "codex" ? actual.stdout.trim() !== `codex-cli ${version}` : !actual.stdout.trim().startsWith(`${version} `)) throw new Error("Native catalog executable pin mismatch");
  let rows = await readers[provider](grant, env);
  if (provider === "codex" && grant.binding.method === "api-key") {
    const inventory = await (readers.openai || readOpenAIModels)(grant);
    const available = new Set(inventory.map(row => row.model));
    rows = rows.filter(row => available.has(row.model || row.id));
    const known = new Set(rows.map(row => row.model || row.id));
    rows = rows.concat(inventory.filter(row => !known.has(row.model)));
  }
  await grant.revalidate();
  const models = [], ids = new Set(); let defaultModel = null;
  for (const row of rows) {
    const id = provider === "codex" ? row.model || row.id : row.resolvedModel || row.value;
    if (typeof id !== "string" || !id || id.length > 160 || ids.has(id)) continue;
    ids.add(id);
    if (row.isDefault || row.value === "default") defaultModel = id;
    const efforts = provider === "codex" ? (row.supportedReasoningEfforts || []).map(item => item.reasoningEffort) : row.supportedEffortLevels || [];
    models.push({ id, name: String(row.displayName || id), provider, available: ready === true,
      unavailableReason: ready ? null : "Connect the selected native account", supportsTools: true,
      input: provider === "codex" && Array.isArray(row.inputModalities) ? row.inputModalities : ["text"],
      efforts: efforts.filter(value => typeof value === "string").map(id => ({ id, label: id })),
      defaultEffort: typeof row.defaultReasoningEffort === "string" ? row.defaultReasoningEffort : null });
  }
  return { agentId: grant.connection, models, defaultModel, fetchedAt: new Date().toISOString(), stale: false, runtime: { name: provider, version } };
}
