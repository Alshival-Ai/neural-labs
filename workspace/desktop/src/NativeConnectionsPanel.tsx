import { useContext, useEffect, useState } from "react";
import { TerminalLaunchContext } from "./TerminalLaunchContext";
import { nativeRequest, nativeSelection, selectNativeConnection, type NativeConnection } from "./nativeApi";
import { settingsRequest } from "./settingsApi";
import type { ProviderCatalog } from "./modelProviders";

export function NativeConnectionsPanel({ csrfToken, administrator = false }: { csrfToken: string; administrator?: boolean }) {
  const [connections, setConnections] = useState<NativeConnection[]>([]);
  const [selected, setSelected] = useState(nativeSelection()?.connection || "");
  const [model, setModel] = useState(nativeSelection()?.model || "");
  const [scope, setScope] = useState<NativeConnection["scope"]>("personal");
  const [provider, setProvider] = useState<"codex" | "claude">("codex");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<string>();
  const [catalog, setCatalog] = useState<ProviderCatalog>();
  const launchTerminal = useContext(TerminalLaunchContext);
  const refresh = async () => {
    const result = await settingsRequest<{ connections: NativeConnection[] }>("/api/runtime/connections");
    if (!Array.isArray(result.connections)) throw new Error("The connection list is unavailable");
    setConnections(result.connections);
  };
  useEffect(() => { void refresh().catch(error => setNotice(error.message)); }, []);
  const work = async (action: () => Promise<void>) => {
    setBusy(true); setNotice(undefined);
    try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : "The connection could not be updated"); }
    finally { setBusy(false); }
  };
  const current = connections.find(row => row.id === selected);
  const configure = async () => {
    const result = await settingsRequest<{ id: string }>("/api/runtime/connections", { method: "POST", headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ scope, provider, label: `${scope === "personal" ? "Personal" : scope[0].toUpperCase() + scope.slice(1)} ${provider === "codex" ? "Codex" : "Claude"}` }) });
    await refresh(); setSelected(result.id); setModel(""); setCatalog(undefined); setNotice("Connection created. Sign in, then load its models.");
  };
  const canManage = current && (current.scope === "personal" || administrator);
  return <section className="model-provider-fields" aria-label="Native AI connections">
    <h2>AI connections</h2>
    <p>Connect Codex or Claude with their native sign-in. Your personal connection is the default; shared AI is used only when you select it.</p>
    <label>Connection<select value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setModel(""); setCatalog(undefined); setNotice(undefined); }}>
      <option value="">Choose a connection</option>
      {connections.map(row => <option key={row.id} value={row.id}>{row.label} · {row.scope}{row.enabled ? "" : " · paused"}</option>)}
    </select></label>
    <label>Model<select value={model} disabled={busy || !catalog} onChange={event => setModel(event.target.value)}>
      <option value="">Choose a model</option>
      {model && !catalog?.models.some(row => row.id === model) && <option value={model}>{model} (saved selection)</option>}
      {catalog?.models.map(row => <option key={row.id} value={row.id} disabled={!row.available}>{row.name}</option>)}
    </select></label>
    {current && <p>{current.method === "subscription" ? "Uses the selected native subscription account." : "Uses the selected API account."}</p>}
    <div className="settings-actions">
      <button className="settings-button" disabled={busy || !current?.enabled} onClick={() => void work(async () => {
        const result = await nativeRequest<ProviderCatalog>("models.list", {}, { connection: selected, model: model || "catalog" });
        setCatalog(result); setNotice("Models loaded from the selected native provider. Choose one to use for your chats.");
      })}>Load models</button>
      <button className="settings-button is-primary" disabled={busy || !current?.enabled || !model.trim() || !["personal", "shared"].includes(current.scope)} onClick={() => {
        selectNativeConnection({ connection: selected, model: model.trim() }); setNotice(`${current?.label} selected for new chats and manual runs.`);
      }}>Use for my chats</button>
      <button className="settings-button" disabled={busy || !canManage || !current?.enabled} onClick={() => void work(async () => {
        const result = await nativeRequest<{ terminalId: string }>("account.login", {}, { connection: selected, model: model.trim() || "account-setup" });
        await launchTerminal(result.terminalId); setNotice("Complete native sign-in in your private Terminal, then check the connection.");
      })}>Sign in in Terminal</button>
      <button className="settings-button" disabled={busy || !current?.enabled} onClick={() => void work(async () => {
        const result = await nativeRequest<{ ready: boolean }>("account.refresh", {}, { connection: selected, model: model.trim() || "account-setup" });
        setNotice(result.ready ? "The selected native account is connected." : "Native sign-in is required for this connection.");
      })}>Check connection</button>
      <button className="settings-button" disabled={busy || !canManage} onClick={() => void work(async () => {
        await settingsRequest(`/api/runtime/connections/${selected}`, { method: "PATCH", headers: { "X-CSRF-Token": csrfToken }, body: JSON.stringify({ generation: current!.generation, enabled: !current!.enabled }) });
        await refresh(); setNotice(current!.enabled ? "Connection paused. Active execution leases will be revoked." : "Connection resumed.");
      })}>{current?.enabled ? "Pause" : "Resume"}</button>
    </div>
    <h3>Add a connection</h3>
    <label>Owner<select value={scope} disabled={busy} onChange={event => setScope(event.target.value as NativeConnection["scope"])}>
      <option value="personal">Personal</option>{administrator && <><option value="shared">Shared workspace</option><option value="team">Team Neura</option><option value="background">Background AI</option></>}
    </select></label>
    <label>Provider<select value={provider} disabled={busy} onChange={event => setProvider(event.target.value as "codex" | "claude")}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
    <button className="settings-button is-primary" disabled={busy} onClick={() => void work(configure)}>Add native connection</button>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
