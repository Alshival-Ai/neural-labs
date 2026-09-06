import { ArrowLeft, ArrowUpRight, Check, CloudCog, Image, KeyRound, LockKeyhole, MapPin, MessageSquareText, PlugZap, Plus, Server, ShieldCheck, Sparkles, UserRound, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { settingsMutationHeaders, settingsRequest, type ApiProviderPlugin, type PluginCatalog } from "./settingsApi";
import { TwilioPluginCard } from "./TwilioPluginCard";
import "./model-providers.css";
import "./plugin-cards.css";

type Plugin = PluginCatalog["plugins"][number];
const labels = { unavailable: "Status unavailable", applying: "Applying…", disconnected: "Not connected", configured: "Configured · not checked", connected: "Connected", "check-failed": "Connection needs attention" };
const PLUGINS_CHANGED = "neural-labs:plugins-changed";
function statusLabel(plugin: Plugin) { return plugin.type === "api-provider" ? labels[plugin.state] : plugin.ready ? "Connected" : plugin.type === "channel" && plugin.configured ? "Needs setup" : plugin.type === "channel" ? "Not configured" : "Offline"; }
function PluginIcon({ plugin }: { plugin: Plugin }) {
  const Icon = plugin.type === "channel" ? MessageSquareText : plugin.type === "mcp" ? PlugZap : plugin.id === "google-maps" ? MapPin : plugin.id === "klipy" ? Sparkles : Image;
  return <Icon aria-hidden="true" />;
}

export function PluginCardsPanel({ administrator, csrfToken, renderSystem }: { administrator: boolean; csrfToken: string; renderSystem: (plugin: Extract<Plugin, { type: "mcp" }>) => ReactNode }) {
  const [catalog, setCatalog] = useState<PluginCatalog>();
  const [error, setError] = useState("");
  const [scope, setScope] = useState<"all" | "private" | "global">("all");
  const [newScope, setNewScope] = useState<"private" | "global">("private");
  const [detail, setDetail] = useState<string | null>(null);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++request.current;
    try {
      const next = await settingsRequest<PluginCatalog>("/api/plugins");
      if (version === request.current) { setCatalog(next); setError(""); }
    } catch (cause) { if (version === request.current) setError(cause instanceof Error ? cause.message : "Plugins could not load"); }
  }, []);
  useEffect(() => {
    void refresh();
    const changed = () => void refresh();
    window.addEventListener(PLUGINS_CHANGED, changed);
    window.addEventListener("focus", changed);
    const timer = window.setInterval(changed, 15_000);
    return () => { request.current++; window.clearInterval(timer); window.removeEventListener(PLUGINS_CHANGED, changed); window.removeEventListener("focus", changed); };
  }, [refresh]);
  const back = () => setDetail(null);
  const update = (plugin: Plugin) => { setCatalog((current) => current && ({ plugins: current.plugins.map((item) => item.id === plugin.id ? plugin : item) })); window.dispatchEvent(new Event(PLUGINS_CHANGED)); };
  const selected = catalog?.plugins.find((plugin) => plugin.id === detail);
  const heading = (title: string, description: string) => <header className="settings-section-header"><div><span>Workspace capabilities</span><h1>{title}</h1><p>{description}</p></div><PlugZap /></header>;
  return <div className="settings-panel plugin-cards-panel">
    {error && <p role="alert" className="settings-error-note">{error}<button className="settings-button" type="button" onClick={() => void refresh()}>Retry plugins</button></p>}
    {!catalog && !error && <p role="status">Loading plugins…</p>}
    {detail === "add" ? <>
      <button className="settings-back-button" type="button" onClick={back}><ArrowLeft />All plugins</button>
      {heading("Add a plugin", "Future connections for your agents or the workspace.")}
      <div className="settings-plugin-scope-picker" aria-label="Plugin scope">
        <button type="button" className={newScope === "private" ? "is-active" : ""} onClick={() => setNewScope("private")}><UserRound /><span><strong>Private plugin</strong><small>Only your agents · your credentials</small></span><Check /></button>
        <button type="button" className={newScope === "global" ? "is-active" : ""} disabled={!administrator} onClick={() => setNewScope("global")}><Users /><span><strong>Global plugin</strong><small>Every member · administrator managed</small></span>{administrator ? <Check /> : <LockKeyhole />}</button>
      </div>
      <section className="settings-card settings-connector-choice"><Server /><div><h2>MCP server</h2><p>Remote server installation is in development.</p></div><span className="settings-connector-planned">In development</span></section>
      <p className="settings-trust-note"><ShieldCheck />This installation flow is a product preview. Server URLs and credentials cannot be submitted here.</p>
    </> : selected ? <>
      {selected.type === "channel" ? <TwilioPluginCard key={selected.id} initial={selected} csrfToken={csrfToken} detailOnly onBack={back} onStatus={update} /> : <>
        <button className="settings-back-button" type="button" onClick={back}><ArrowLeft />All plugins</button>
        {selected.type === "api-provider" ? <ProviderDetail key={selected.id} plugin={selected} csrfToken={csrfToken} onStatus={update} /> : renderSystem(selected)}
      </>}
    </> : catalog && <>
      <div className="settings-connectors-heading">{heading("Plugins", "Connect services and tools for your workspace.")}<button type="button" className="settings-button is-primary" onClick={() => setDetail("add")}><Plus />Add plugin</button></div>
      <div className="settings-plugin-tabs" role="tablist" aria-label="Plugin scope">{(["all", "private", "global"] as const).map((value) => <button type="button" role="tab" aria-selected={scope === value} className={scope === value ? "is-active" : ""} key={value} onClick={() => setScope(value)}>{value === "all" ? "All" : value === "private" ? "Private" : "Global"}</button>)}</div>
      <div className="provider-card-grid plugin-card-grid">{catalog.plugins.filter((plugin) => scope === "all" || scope === plugin.scope).map((plugin) => <article className="settings-card provider-card" key={plugin.id}>
        <button className="provider-card-main" type="button" aria-label={`${plugin.editable ? plugin.type !== "mcp" && !plugin.configured ? "Set up" : "Manage" : "View details for"} ${plugin.name}`} onClick={() => setDetail(plugin.id)}>
          <span className="provider-card-icon"><PluginIcon plugin={plugin} /></span><ArrowUpRight className="provider-card-arrow" aria-hidden="true" />
          <strong>{plugin.name}</strong><span className="provider-card-description">{plugin.description}</span><span className={`provider-card-status${plugin.ready ? " is-connected" : ""}`}>{statusLabel(plugin)}</span>
          <span className="plugin-card-scope">{plugin.scope === "global" ? "Workspace" : "Private"}{plugin.ownership === "system" ? " · System plugin" : !plugin.editable ? " · Administrator managed" : ""}</span>
          <span className="plugin-card-action">{plugin.editable ? plugin.type !== "mcp" && !plugin.configured ? "Set up" : "Manage" : "View details"}</span>
        </button>
      </article>)}</div>
      {(scope === "private" || scope === "all") && !catalog.plugins.some((plugin) => plugin.scope === "private") && <section className="settings-plugin-empty"><UserRound /><div><h2>Your plugins</h2><p>No private plugins yet.</p><button className="settings-button" type="button" onClick={() => { setNewScope("private"); setDetail("add"); }}>Add your first private plugin</button></div></section>}
      {scope === "global" && !catalog.plugins.some((plugin) => plugin.scope === "global") && <p role="status">No workspace plugins available.</p>}
    </>}
  </div>;
}

function ProviderDetail({ plugin, csrfToken, onStatus }: { plugin: ApiProviderPlugin; csrfToken: string; onStatus: (plugin: ApiProviderPlugin) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function action(kind: "save" | "inherit" | "disconnect" | "check") {
    if (pending.current) return;
    if ((kind === "disconnect" || kind === "inherit") && !window.confirm(kind === "disconnect" ? `Disconnect ${plugin.name} for the workspace?` : `Use deployment configuration for ${plugin.name}? This removes the Settings override.`)) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const next = await settingsRequest<ApiProviderPlugin>(`/api/admin/plugins/providers/${plugin.id}${kind === "check" ? "/check" : ""}`, {
        method: kind === "check" ? "POST" : kind === "disconnect" ? "DELETE" : "PUT", headers: settingsMutationHeaders(csrfToken),
        ...(kind !== "disconnect" ? { body: JSON.stringify(kind === "save" ? { action: "save", apiKey: key } : kind === "inherit" ? { action: "inherit" } : {}) } : {}),
      });
      setKey(""); onStatus(next);
      setNotice(kind === "check" ? "Connection check completed." : "Saved. Changes apply automatically within 15 seconds.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Plugin settings could not be updated."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <>
    <header className="settings-section-header"><div><span>Workspace service</span><h1>{plugin.name}</h1><p>{plugin.description}</p></div><CloudCog /></header>
    {error && <p role="alert" className="settings-error-note">{error}</p>}{notice && <p role="status" className="settings-success-note">{notice}</p>}
    <section className="settings-card plugin-provider-details">
      <div className="settings-card__heading"><div><h2>Connection</h2><p>{labels[plugin.state]}</p></div><KeyRound /></div>
      <p>{plugin.source === "environment" ? "Using deployment configuration." : plugin.source === "settings" ? "Using the API key saved in Settings." : "No active API key."}</p>
      {plugin.state === "applying" && <p role="status">Waiting for workspace tools to apply this configuration.</p>}
      {plugin.state === "unavailable" && <p role="status">Runtime status is unavailable. Saved settings are retained.</p>}
      {plugin.id === "google-maps" && <p>This key is shared by Places and Geocoding. Enable both APIs in the Google Cloud project.</p>}
      {plugin.editable ? <>
        <form className="plugin-key-form" onSubmit={(event) => { event.preventDefault(); void action("save"); }}>
          <label>API key<input type="password" autoComplete="new-password" value={key} onChange={(event) => setKey(event.target.value)} maxLength={4096} required placeholder={plugin.configured ? "Enter a replacement key" : "Enter your API key"} /></label>
          <p>Keys are encrypted. Saved keys are never displayed.</p>
          <button className="settings-button is-primary" disabled={busy || !key.trim()}>{busy ? "Working…" : "Save key"}</button>
        </form>
        <div className="plugin-provider-actions"><button type="button" className="settings-button" disabled={busy || !plugin.configured || !plugin.applied} onClick={() => void action("check")}>Check connection</button>{plugin.configured && <button type="button" className="settings-button is-danger" disabled={busy} onClick={() => void action("disconnect")}>Disconnect {plugin.name}</button>}{plugin.deploymentOverride && <button type="button" className="settings-button" disabled={busy} onClick={() => void action("inherit")}>Use deployment configuration</button>}</div>
      </> : <p>Only a workspace administrator can change this connection.</p>}
    </section>
    <section className="settings-card plugin-provider-details"><h2>Capabilities</h2>{plugin.capabilities.map((name) => { const check = plugin.check?.capabilities.find((item) => item.name === name); return <div className="plugin-capability" key={name}><strong>{name}</strong><span>{check ? `${check.ok ? "✓ " : ""}${check.message}` : "Not checked"}</span></div>; })}</section>
  </>;
}
