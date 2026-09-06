import { ArrowLeft, ArrowUpRight, Bot, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PersonalProviderConnection } from "./PersonalProviderConnection";
import { ModelDefaultsPanel } from "./ModelDefaultsPanel";
import { settingsMutationHeaders, settingsRequest } from "./settingsApi";
import type { PersonalOpenAIAuth } from "./UserSettingsApp";
import type { ProviderCatalog } from "./modelProviders";
import "./model-providers.css";

export function ModelProviderPanel({ csrfToken }: { csrfToken: string }) {
  const [detail, setDetail] = useState<"openai" | "claude">();
  const [connection, setConnection] = useState<PersonalOpenAIAuth>();
  const [error, setError] = useState<string>();
  const [disconnectError, setDisconnectError] = useState<string>();
  const [reload, setReload] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog>();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const [refreshNotice, setRefreshNotice] = useState<string>();
  const [refreshedStatus, setRefreshedStatus] = useState<PersonalOpenAIAuth>();
  const focusTarget = useRef<HTMLHeadingElement>(null);
  const initial = useRef(true);
  useEffect(() => {
    if (!initial.current) focusTarget.current?.focus();
    initial.current = false;
  }, [detail, confirm]);
  useEffect(() => {
    if (detail || busy) return;
    let active = true;
    let timer: number | undefined;
    async function refresh() {
      try {
        const result = await settingsRequest<PersonalOpenAIAuth>("/api/account/openai");
        if (!active) return;
        setConnection(result); setError(undefined);
        if (["starting", "awaiting_user"].includes(result.state)) timer = window.setTimeout(() => void refresh(), 1_500);
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : "Connection status could not be loaded.");
      }
    }
    void refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [detail, reload, busy]);
  async function disconnect() {
    setBusy(true); setDisconnectError(undefined); setNotice(undefined);
    try {
      const result = await settingsRequest<PersonalOpenAIAuth>("/api/account/openai/disconnect", { method: "POST", headers: settingsMutationHeaders(csrfToken) });
      setConnection(result); setConfirm(false);
      setNotice("OpenAI disconnected. Your chats and saved preferences are unchanged.");
    } catch (error) {
      setDisconnectError(error instanceof Error ? error.message : "OpenAI could not be disconnected.");
    } finally { setBusy(false); }
  }
  async function refreshProvider() {
    setRefreshing(true); setRefreshError(undefined); setRefreshNotice(undefined);
    try {
      const catalog = await settingsRequest<ProviderCatalog>("/api/account/model-providers/catalog", { method: "POST", headers: settingsMutationHeaders(csrfToken) });
      setProviderCatalog(catalog);
      if (catalog.stale) throw new Error(catalog.message ?? "Refresh failed. Showing cached models.");
      const status = await settingsRequest<PersonalOpenAIAuth>("/api/account/openai");
      setConnection(status);
      setRefreshedStatus(status);
      setRefreshNotice("Connection and models refreshed. Your defaults are unchanged.");
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "OpenAI could not be refreshed. Try again.");
    } finally { setRefreshing(false); }
  }
  const connected = connection?.authenticated === true;
  const pending = connection && ["starting", "awaiting_user"].includes(connection.state);
  const status = !connection ? "Checking connection…" : connected ? connection.paused ? "Connected · paused" : connection.modelReady ? "Connected" : "Connected · setup pending" : pending ? "Sign-in in progress" : "Not connected";
  const refreshControls = <div className="provider-refresh">
    <button type="button" className="settings-button" disabled={refreshing || busy || confirm || Boolean(pending)} onClick={() => void refreshProvider()}><RefreshCw aria-hidden="true" />{refreshing ? "Refreshing…" : "Refresh connection"}</button>
    {providerCatalog && <small>{providerCatalog.runtime ? `${providerCatalog.runtime.name} ${providerCatalog.runtime.version} · ` : ""}Models checked {new Date(providerCatalog.fetchedAt).toLocaleString()}{providerCatalog.stale ? " · cached" : ""}</small>}
    {refreshError && <p role="alert">{refreshError}</p>}
    {refreshNotice && <p role="status">{refreshNotice}</p>}
  </div>;
  return <div className="settings-panel user-settings-app model-provider-page">
    {detail ? <>
      <button type="button" className="settings-button provider-back" disabled={refreshing} onClick={() => setDetail(undefined)}><ArrowLeft aria-hidden="true" />Back to providers</button>
      <div className="settings-section-header"><div><h1 ref={focusTarget} tabIndex={-1}>{detail === "openai" ? "OpenAI" : "Claude"}</h1><p>{detail === "openai" ? "Manage your personal ChatGPT connection." : "Anthropic’s AI assistant."}</p></div></div>
      {detail === "openai" ? <><PersonalProviderConnection csrfToken={csrfToken} refreshedStatus={refreshedStatus} />{refreshControls}<p className="provider-refresh-hint">Rechecks your connection and available models. It does not reinstall the plugin, disconnect your account, or change saved defaults.</p></> : <section className="settings-card"><h2>Claude is coming soon</h2><p className="model-provider-unavailable">Claude sign-in is not available in this release. It requires a supported subscription sign-in route and an isolated Claude runtime. You do not need to provide tokens or API keys.</p></section>}
    </> : <>
      <div className="settings-section-header"><div><span><Bot />Personal agent</span><h1 ref={confirm ? undefined : focusTarget} tabIndex={-1}>Model Provider</h1><p>Connect your accounts and choose how your private Neura works.</p></div></div>
      {notice && <p role="status">{notice}</p>}
      {error && <div role="alert"><p>{error}</p>{!confirm && <button type="button" className="settings-button" onClick={() => setReload((value) => value + 1)}>Retry connection status</button>}</div>}
      {connected && <ModelDefaultsPanel csrfToken={csrfToken} compact updatedCatalog={providerCatalog} onCatalog={setProviderCatalog} />}
      <section aria-label="Model providers" className="provider-overview">
        <div><h2>Your providers</h2><p>{connected ? "Select a provider to manage its connection." : "Set up a provider to choose your default model and reasoning."}</p></div>
        <div className="provider-card-grid">
          <article className="settings-card provider-card">
            <button type="button" className="provider-card-main" aria-label="Configure OpenAI" disabled={busy || confirm || refreshing} onClick={() => setDetail("openai")}>
              <span className="provider-card-icon"><Bot aria-hidden="true" /></span><ArrowUpRight className="provider-card-arrow" aria-hidden="true" />
              <strong>OpenAI</strong><span className="provider-card-description">Connect with ChatGPT</span><span className={`provider-card-status${connected ? " is-connected" : ""}`}>{error && !connection ? "Status unavailable" : status}</span>
            </button>
            {confirm ? <div className="provider-disconnect-confirm">
              <h3 ref={focusTarget} tabIndex={-1}>Disconnect OpenAI?</h3>
              <p>Your private Neura will be unavailable until you reconnect. Chats and preferences stay saved. Workspace and Team connections are not affected.</p>
              {disconnectError && <p role="alert">{disconnectError}</p>}
              <button type="button" className="settings-button is-primary" disabled={busy} onClick={() => void disconnect()}>{busy ? "Disconnecting…" : "Confirm disconnect"}</button>
              <button type="button" className="settings-button" disabled={busy} onClick={() => { setConfirm(false); setDisconnectError(undefined); }}>Keep connected</button>
            </div> : <button type="button" className={`settings-button${connected ? "" : " is-primary"}`} disabled={busy || refreshing || !connection || Boolean(error)} onClick={() => { setNotice(undefined); connected ? setConfirm(true) : setDetail("openai"); }}>{connected ? "Disconnect" : pending ? "Continue setup" : "Set up OpenAI"}</button>}
            {refreshControls}
          </article>
          <article className="settings-card provider-card">
            <button type="button" className="provider-card-main" aria-label="Configure Claude" disabled={busy || confirm} onClick={() => setDetail("claude")}>
              <span className="provider-card-icon is-claude"><Sparkles aria-hidden="true" /></span><ArrowUpRight className="provider-card-arrow" aria-hidden="true" />
              <strong>Claude</strong><span className="provider-card-description">Connect with Anthropic</span><span className="provider-card-status">Coming soon</span>
            </button>
            <button type="button" className="settings-button" disabled>Set up Claude · unavailable</button>
          </article>
        </div>
      </section>
    </>}
  </div>;
}
