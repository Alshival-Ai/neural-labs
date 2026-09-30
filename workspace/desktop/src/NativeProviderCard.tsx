import { useContext, useEffect, useRef, useState } from "react";
import { TerminalLaunchContext } from "./TerminalLaunchContext";
import { nativeRequest, nativeSelection, type NativeConnection, type NativeSelection } from "./nativeApi";
import type { ProviderCatalog } from "./modelProviders";

type Provider = NativeConnection["provider"];
type AccountStatus = { ready: boolean; pending?: boolean; signIn?: { verificationUrl: string; userCode: string } };
const OPENAI_DEVICE_URL = "https://auth.openai.com/codex/device";

export function NativeProviderCard({ provider, connection, ensureConnection, onSelect }: {
  provider: Provider; connection?: NativeConnection; ensureConnection: (provider: Provider) => Promise<NativeConnection>;
  onSelect: (selection: NativeSelection, generation: number) => Promise<void>;
}) {
  const launchTerminal = useContext(TerminalLaunchContext);
  const [status, setStatus] = useState<AccountStatus>();
  const [catalog, setCatalog] = useState<ProviderCatalog>();
  const [model, setModel] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const autoSelect = useRef(false);
  const loadingModels = useRef(false);
  const connectionId = connection?.id;
  const name = provider === "codex" ? "OpenAI" : "Anthropic";

  async function loadModels(id: string, activate = autoSelect.current) {
    if (loadingModels.current) return;
    loadingModels.current = true;
    try {
      const result = await nativeRequest<ProviderCatalog>("models.list", {}, { connection: id, model: "catalog" });
      setCatalog(result);
      const saved = nativeSelection();
      const preferred = saved?.connection === id && result.models.some(row => row.id === saved.model && row.available)
        ? saved.model : result.models.find(row => row.id === result.defaultModel && row.available)?.id
          || result.models.find(row => row.available)?.id || "";
      setModel(preferred);
      if (activate && preferred) {
        await onSelect({ connection: id, model: preferred }, connection?.generation || 1);
        autoSelect.current = false;
        setNotice(`${name} is ready for your chats. You can change the model below.`);
      } else if (!preferred) setNotice("No available models were returned. Check your account and reload models.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Models could not be loaded."); }
    finally { loadingModels.current = false; }
  }

  async function check(id: string) {
    const next = await nativeRequest<AccountStatus>("account.status", {}, { connection: id, model: "account-setup" });
    setStatus(next);
    if (next.ready) {
      setConnecting(false);
      if (!catalog) await loadModels(id);
    } else if (next.pending === false) {
      setConnecting(false); autoSelect.current = false;
      setNotice(`${name} sign-in ended. Start a new sign-in to try again.`);
    }
  }

  useEffect(() => {
    setStatus(undefined); setCatalog(undefined); setModel(""); setNotice(undefined);
    if (!connectionId || !connection?.enabled) return;
    let active = true;
    void nativeRequest<AccountStatus>("account.status", {}, { connection: connectionId, model: "account-setup" })
      .then(async next => {
        if (!active) return;
        setStatus(next);
        if (next.pending) { autoSelect.current = true; setConnecting(true); }
        if (next.ready) await loadModels(connectionId, false);
      }).catch(error => { if (active) setNotice(error instanceof Error ? error.message : "Connection could not be checked."); });
    return () => { active = false; };
  }, [connectionId, connection?.enabled]);

  useEffect(() => {
    if (!connecting || !connectionId) return;
    const timer = window.setInterval(() => void check(connectionId).catch(error => {
      setNotice(error instanceof Error ? error.message : "Sign-in could not be checked.");
    }), 2000);
    return () => window.clearInterval(timer);
  }, [connecting, connectionId, catalog]);

  async function start() {
    setBusy(true); setNotice(undefined);
    if (provider === "codex") {
      // The tab opens from the click so browser popup blockers do not interrupt sign-in.
      try { window.open(OPENAI_DEVICE_URL, "_blank", "noopener,noreferrer"); } catch { /* The link remains in the card. */ }
    }
    try {
      const target = connection || await ensureConnection(provider);
      if (!target.enabled) throw new Error("Resume this connection in Advanced connections before signing in.");
      autoSelect.current = true;
      const result = await nativeRequest<{ terminalId: string }>("account.login", {}, { connection: target.id, model: "account-setup" });
      setConnecting(true);
      if (provider === "claude") {
        await launchTerminal(result.terminalId);
        setNotice("Complete Anthropic sign-in in the private Terminal. Paste Anthropic's returned code there.");
      } else setNotice("Enter the one-time code below on the OpenAI sign-in tab.");
      await check(target.id);
    } catch (error) { autoSelect.current = false; setNotice(error instanceof Error ? error.message : "Sign-in could not start."); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!connectionId) return;
    setBusy(true);
    try {
      await nativeRequest("account.cancel", {}, { connection: connectionId, model: "account-setup" });
      setConnecting(false); setStatus(undefined); autoSelect.current = false; setNotice("Sign-in cancelled.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Sign-in could not be cancelled."); }
    finally { setBusy(false); }
  }

  const selected = nativeSelection();
  const active = selected?.connection === connectionId && selected?.model === model;
  return <section className={`settings-card native-provider-card native-provider-card--${provider}`} aria-label={`${name} model provider`}>
    <div className="settings-card__heading"><div><span>Model provider</span><h2>{name}</h2>
      <p>{provider === "codex" ? "Connect your ChatGPT account with a one-time code. Your models load as soon as sign-in finishes." : "Connect your Claude account. Anthropic gives you a code to paste into the private sign-in Terminal."}</p></div></div>
    <p className="native-provider-status" role="status">{connection && !connection.enabled ? "Paused" : status?.ready ? active ? "Connected · ready for chats" : "Connected · choose a model" : connecting ? "Waiting for sign-in" : connection ? "Not connected" : "No connection yet"}</p>
    {!status?.ready && <div className="native-provider-steps">
      <p><strong>1.</strong> {provider === "codex" ? "Open OpenAI sign-in in a new tab." : "Start Anthropic sign-in in a private Terminal."}</p>
      {provider === "codex" && status?.signIn?.userCode && <p className="native-provider-code"><strong>2. One-time code</strong><code>{status.signIn.userCode}</code>
        <button className="settings-button" type="button" onClick={() => {
          if (!navigator.clipboard?.writeText) { setNotice("Copy the code shown above."); return; }
          void navigator.clipboard.writeText(status.signIn!.userCode).catch(() => setNotice("Copy the code shown above."));
        }}>Copy code</button></p>}
      <p><strong>{provider === "codex" ? "3." : "2."}</strong> Models load automatically after sign-in. Your provider's default available model is selected for chats.</p>
    </div>}
    <div className="settings-actions">
      {!status?.ready && <button className="settings-button is-primary" type="button" disabled={busy || connection?.enabled === false} onClick={() => void start()}>{busy ? "Starting…" : connecting ? "Continue sign-in" : `Connect ${name}`}</button>}
      {provider === "codex" && connecting && <a className="settings-button" href={status?.signIn?.verificationUrl || OPENAI_DEVICE_URL} target="_blank" rel="noreferrer">Open OpenAI sign-in</a>}
      {connecting && <button className="settings-button" type="button" disabled={busy} onClick={() => void cancel()}>Cancel sign-in</button>}
    </div>
    {status?.ready && <div className="native-provider-ready"><label>{name} model<select value={model} disabled={!catalog || busy} onChange={event => {
      const value = event.target.value; setModel(value);
      if (connectionId && value) void onSelect({ connection: connectionId, model: value }, connection?.generation || 1)
        .then(() => setNotice(`${name} model selected for your chats.`))
        .catch(error => setNotice(error instanceof Error ? error.message : "The model could not be selected."));
    }}><option value="">Choose a model</option>{catalog?.models.map(row => <option key={row.id} value={row.id} disabled={!row.available}>{row.name}</option>)}</select></label>
      {!active && model && connectionId && <button className="settings-button is-primary" type="button" onClick={() => void onSelect({ connection: connectionId, model }, connection?.generation || 1)
        .then(() => setNotice(`${name} is ready for your chats.`))
        .catch(error => setNotice(error instanceof Error ? error.message : "The model could not be selected."))}>Use for my chats</button>}
      <button className="settings-button" type="button" disabled={busy} onClick={() => connectionId && void loadModels(connectionId, false)}>Reload models</button>
    </div>}
    {notice && <p className="settings-card-note" role="status">{notice}</p>}
  </section>;
}
