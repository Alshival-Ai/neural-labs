import { useContext, useEffect, useState } from "react";
import { NativeProviderCard } from "./NativeProviderCard";
import { TerminalLaunchContext } from "./TerminalLaunchContext";
import { nativeRequest, nativeSelection, saveNativeDefault, selectNativeConnection, type NativeConnection, type NativeSelection } from "./nativeApi";
import { settingsRequest } from "./settingsApi";
import type { ProviderCatalog } from "./modelProviders";

type Provider = NativeConnection["provider"];
export function NativeConnectionsPanel({ csrfToken, administrator = false }: { csrfToken: string; administrator?: boolean }) {
  const [connections, setConnections] = useState<NativeConnection[]>([]);
  const [selected, setSelected] = useState("");
  const [scope, setScope] = useState<NativeConnection["scope"]>("personal");
  const [provider, setProvider] = useState<Provider>("codex");
  const [advancedModel, setAdvancedModel] = useState("");
  const [advancedCatalog, setAdvancedCatalog] = useState<ProviderCatalog>();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<string>();
  const launchTerminal = useContext(TerminalLaunchContext);
  const selectPersonal = async (selection: NativeSelection, generation: number) => {
    await saveNativeDefault(selection, generation);
    selectNativeConnection(selection);
  };
  const refresh = async () => {
    const result = await settingsRequest<{ connections: NativeConnection[] }>("/api/runtime/connections");
    if (!Array.isArray(result.connections)) throw new Error("The connection list is unavailable");
    setConnections(result.connections);
    return result.connections;
  };
  useEffect(() => { void refresh().catch(error => setNotice(error instanceof Error ? error.message : "Connections could not be loaded.")); }, []);
  const ensurePersonal = async (which: Provider) => {
    const existing = connections.find(row => row.scope === "personal" && row.provider === which);
    if (existing) return existing;
    const result = await settingsRequest<{ id: string }>("/api/runtime/connections", { method: "POST", headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ scope: "personal", provider: which, label: `Personal ${which === "codex" ? "OpenAI" : "Anthropic"}` }) });
    const created = (await refresh()).find(row => row.id === result.id);
    if (!created) throw new Error("The new connection could not be loaded.");
    return created;
  };
  const current = connections.find(row => row.id === selected);
  const manage = async (action: () => Promise<void>) => {
    setBusy(true); setNotice(undefined);
    try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : "The connection could not be updated."); }
    finally { setBusy(false); }
  };
  return <section className="model-provider-fields" aria-label="Native AI connections">
    <h2>AI connections</h2>
    <p>Connect your provider account in its card. After sign-in, models load and the default available model is ready for your chats.</p>
    <div className="native-provider-grid">
      <NativeProviderCard provider="codex" connection={connections.find(row => row.scope === "personal" && row.provider === "codex" && row.id === nativeSelection()?.connection) || connections.find(row => row.scope === "personal" && row.provider === "codex")} ensureConnection={ensurePersonal} onSelect={selectPersonal} />
      <NativeProviderCard provider="claude" connection={connections.find(row => row.scope === "personal" && row.provider === "claude" && row.id === nativeSelection()?.connection) || connections.find(row => row.scope === "personal" && row.provider === "claude")} ensureConnection={ensurePersonal} onSelect={selectPersonal} />
    </div>
    <details className="native-provider-advanced"><summary>Advanced connections</summary>
      <p>Manage additional personal, shared, Team Alshival, and background connections.</p>
      <label>Connection<select value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setAdvancedModel(""); setAdvancedCatalog(undefined); }}>
        <option value="">Choose a connection</option>{connections.map(row => <option key={row.id} value={row.id}>{row.label} · {row.scope}{row.enabled ? "" : " · paused"}</option>)}
      </select></label>
      {current && <><p>{current.method === "subscription" ? "Uses the selected native subscription account." : "Uses the selected API account."}</p>
        <div className="settings-actions">
          <button className="settings-button" disabled={busy || !current.enabled} onClick={() => void manage(async () => {
            const result = await nativeRequest<ProviderCatalog>("models.list", {}, { connection: current.id, model: "catalog" });
            setAdvancedCatalog(result); setAdvancedModel(result.defaultModel || result.models.find(row => row.available)?.id || "");
            setNotice("Models loaded for this connection.");
          })}>Load models</button>
          <button className="settings-button" disabled={busy || !current.enabled} onClick={() => void manage(async () => {
            const result = await nativeRequest<{ terminalId: string }>("account.login", {}, { connection: current.id, model: "account-setup" });
            await launchTerminal(result.terminalId); setNotice("Complete sign-in in the private Terminal.");
          })}>Start sign-in</button>
          {["personal", "shared"].includes(current.scope) && <button className="settings-button is-primary" disabled={busy || !current.enabled || !advancedModel} onClick={() => void manage(async () => {
            await selectPersonal({ connection: current.id, model: advancedModel }, current.generation);
            setNotice(`${current.label} selected for your chats.`);
          })}>Use for my chats</button>}
          {administrator && current.scope === "team" && <button className="settings-button is-primary" disabled={busy || !current.enabled || !advancedModel} onClick={() => void manage(async () => {
            await saveNativeDefault({ connection: current.id, model: advancedModel }, current.generation, true);
            setNotice(`${current.label} selected for Team Chat.`);
          })}>Use for Team Chat</button>}
          <button className="settings-button" disabled={busy || current.scope !== "personal" && !administrator} onClick={() => void manage(async () => {
            await settingsRequest(`/api/runtime/connections/${current.id}`, { method: "PATCH", headers: { "X-CSRF-Token": csrfToken }, body: JSON.stringify({ generation: current.generation, enabled: !current.enabled }) });
            await refresh(); setNotice(current.enabled ? "Connection paused." : "Connection resumed.");
          })}>{current.enabled ? "Pause" : "Resume"}</button>
        </div>
        {advancedCatalog && <label>Model<select value={advancedModel} onChange={event => setAdvancedModel(event.target.value)}><option value="">Choose a model</option>{advancedCatalog.models.map(row => <option key={row.id} value={row.id} disabled={!row.available}>{row.name}</option>)}</select></label>}
      </>}
      <h3>Add another connection</h3>
      <label>Owner<select value={scope} disabled={busy} onChange={event => setScope(event.target.value as NativeConnection["scope"])}><option value="personal">Personal</option>{administrator && <><option value="shared">Shared workspace</option><option value="team">Team Alshival</option><option value="background">Background AI</option></>}</select></label>
      <label>Provider<select value={provider} disabled={busy} onChange={event => setProvider(event.target.value as Provider)}><option value="codex">OpenAI</option><option value="claude">Anthropic</option></select></label>
      <button className="settings-button" disabled={busy} onClick={() => void manage(async () => {
        const result = await settingsRequest<{ id: string }>("/api/runtime/connections", { method: "POST", headers: { "X-CSRF-Token": csrfToken }, body: JSON.stringify({ scope, provider, label: `${scope} ${provider === "codex" ? "OpenAI" : "Anthropic"}` }) });
        await refresh(); setSelected(result.id); setNotice("Connection created. Select it above to finish setup.");
      })}>Add connection</button>
      {notice && <p role="status">{notice}</p>}
    </details>
  </section>;
}
