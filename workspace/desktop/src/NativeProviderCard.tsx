import { useEffect, useRef, useState } from "react";
import { nativeRequest, nativeSelection, type NativeConnection, type NativeSelection } from "./nativeApi";
import type { ProviderCatalog } from "./modelProviders";

type SignIn = { attemptId?: string; stage?: string; expiresAt?: number; verificationUrl?: string; userCode?: string; error?: string; model?: string };
type AccountStatus = { ready: boolean; pending?: boolean; reason?: string; model?: string; signIn?: SignIn };
const ACTIVE = ["starting", "awaiting-code", "connecting", "loading-models", "verifying"];
const OPENAI_DEVICE_URL = "https://auth.openai.com/codex/device";
const messages: Record<string, string> = {
  "authentication-required": "Your Anthropic connection needs to be renewed. Reconnect to continue.",
  "usage-limit": "Your account has reached a usage limit. Try checking again when usage is available.",
  "model-unavailable": "This model is unavailable for your account. Try checking again later.",
  "provider-unavailable": "We couldn't check the connection right now. Try checking again.",
  "sign-in-failed": "Anthropic couldn't complete sign-in. Start again to get a new code.",
};
export function NativeProviderCard({ provider, connection, ensureConnection, onSelect, autoActivate = true, canManage = true, onModel }: {
  provider: NativeConnection["provider"]; connection?: NativeConnection;
  ensureConnection: (provider: NativeConnection["provider"]) => Promise<NativeConnection>;
  onSelect: (selection: NativeSelection, generation: number) => Promise<void>;
  autoActivate?: boolean; canManage?: boolean; onModel?: (model: string) => void;
}) {
  const [status, setStatus] = useState<AccountStatus>();
  const [catalog, setCatalog] = useState<ProviderCatalog>();
  const [model, setModel] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const starting = useRef(false);
  const autoSelect = useRef(false), checking = useRef(false), loading = useRef(false);
  const modelRef = useRef(model); modelRef.current = model;
  const refreshModels = useRef<() => void>(() => {});
  const targetRef = useRef(connection); targetRef.current = connection || targetRef.current;
  const popup = useRef<Window | null>(null), openedUrl = useRef<string | undefined>(undefined);
  const name = provider === "codex" ? "OpenAI" : "Anthropic";
  const id = connection?.id, signIn = status?.signIn;
  const reconnect = status?.reason === "authentication-required" || signIn?.error === "authentication-required";
  const pending = connecting || Boolean(status?.pending);
  const stage = signIn?.stage;
  const retryVerification = (stage === "failed" || !stage) && ["usage-limit", "model-unavailable", "provider-unavailable"].includes(signIn?.error || status?.reason || "");

  function showAuthorization(next?: SignIn) {
    if (!next?.verificationUrl || next.verificationUrl === openedUrl.current) return;
    const url = new URL(next.verificationUrl);
    const allowed = provider === "codex" ? url.href === OPENAI_DEVICE_URL
      : url.protocol === "https:" && ["claude.ai", "claude.com", "platform.claude.com"].includes(url.hostname)
        && (url.pathname === "/oauth/authorize" || url.hostname === "claude.com" && url.pathname === "/cai/oauth/authorize") && !url.username && !url.password && !url.port;
    if (!allowed) return;
    openedUrl.current = next.verificationUrl;
    if (popup.current && !popup.current.closed) { popup.current.location.replace(url.href); popup.current = null; }
  }
  async function loadModels(target: NativeConnection, preferredModel?: string) {
    if (loading.current) return; loading.current = true;
    try {
      const result = await nativeRequest<ProviderCatalog>("models.list", {}, { connection: target.id, model: "catalog" });
      if (targetRef.current?.id !== target.id) return;
      setCatalog(result);
      const saved = nativeSelection();
      const preferred = [modelRef.current, saved?.connection === target.id ? saved.model : "", preferredModel, result.defaultModel,
        result.models.find(row => row.available)?.id].find(value => value && result.models.some(row => row.id === value && row.available)) || "";
      setModel(preferred); onModel?.(preferred);
      if (!preferred) { setNotice("No available models were returned. Try loading models again."); return; }
      if (autoSelect.current && autoActivate) await onSelect({ connection: target.id, model: preferred }, target.generation);
      if (autoSelect.current) setNotice(autoActivate ? `${name} is ready for your chats.` : "Connection verified. Choose where to use it below.");
      autoSelect.current = false;
    } finally { loading.current = false; }
  }
  async function check(target: NativeConnection) {
    if (checking.current) return; checking.current = true;
    try {
      const next = await nativeRequest<AccountStatus>("account.status", {}, { connection: target.id, model: "account-setup" });
      if (targetRef.current?.id !== target.id) return;
      setStatus(next); showAuthorization(next.signIn);
      setConnecting(Boolean(next.pending && next.signIn?.stage !== "busy"));
      if (next.ready && (!catalog || autoSelect.current)) await loadModels(target, next.model || next.signIn?.model);
      if (!next.pending && !next.ready) {
        if (provider === "codex" && autoSelect.current) setNotice("OpenAI sign-in ended. Start a new sign-in to try again.");
        autoSelect.current = false;
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : "Connection could not be checked."); }
    finally { checking.current = false; }
  }
  useEffect(() => {
    if (starting.current) return;
    setStatus(undefined); setCatalog(undefined); setCode(""); setModel(""); setNotice(undefined); setConnecting(false);
    if (!connecting) autoSelect.current = false;
    if (connection?.enabled) void check(connection);
  }, [id, connection?.enabled]);
  useEffect(() => () => { popup.current?.close(); popup.current = null; }, []);
  useEffect(() => {
    if (!pending || !connection) return;
    if (stage !== "busy") autoSelect.current = true;
    const timer = window.setInterval(() => void check(connection), 2000);
    return () => window.clearInterval(timer);
  }, [pending, id, stage, catalog]);
  refreshModels.current = () => {
    if (!connection?.enabled || !status?.ready || busy || document.visibilityState === "hidden" || !navigator.onLine) return;
    void loadModels(connection).catch(() => setNotice("Models could not be refreshed. Showing the last loaded list."));
  };
  useEffect(() => {
    const refresh = () => refreshModels.current();
    const timer = window.setInterval(refresh, 5 * 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer); window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh);
    };
  }, [id]);
  async function start() {
    starting.current = true; setBusy(true); setCode(""); setNotice(undefined); openedUrl.current = undefined;
    // Reserve the tab during the user's click; later navigation uses only the
    // validated CLI URL. No authorization data is stored in this tab.
    try { popup.current = provider === "codex" ? window.open(OPENAI_DEVICE_URL, "_blank", "noopener,noreferrer") : window.open("about:blank", "_blank"); if (popup.current) popup.current.opener = null; } catch { popup.current = null; }
    try {
      const target = connection || await ensureConnection(provider); targetRef.current = target;
      const saved = nativeSelection();
      const result = await nativeRequest<SignIn>("account.login", {}, { connection: target.id, model: saved?.connection === target.id ? saved.model : "account-setup" });
      autoSelect.current = true; setConnecting(true); setCatalog(undefined);
      setStatus({ ready: false, pending: true, signIn: result });
      if (provider === "codex" && popup.current) { popup.current.location.replace(OPENAI_DEVICE_URL); popup.current = null; }
      showAuthorization(result); await check(target);
    } catch (error) { popup.current?.close(); popup.current = null; setConnecting(false); setNotice(error instanceof Error ? error.message : "Sign-in could not start."); }
    finally { starting.current = false; setBusy(false); }
  }
  async function action(operation: "account.submit" | "account.cancel" | "account.verify") {
    if (!connection) return; setBusy(true); setNotice(undefined);
    const submitted = code; setCode("");
    try {
      const result = await nativeRequest<SignIn>(operation, { attemptId: signIn?.attemptId, ...(operation === "account.submit" ? { code: submitted } : {}) }, { connection: connection.id, model: "account-setup" });
      if (operation === "account.cancel") { popup.current?.close(); popup.current = null; setConnecting(false); setNotice("Sign-in cancelled."); }
      else { autoSelect.current = true; setStatus({ ready: false, pending: ACTIVE.includes(result.stage || ""), signIn: result }); }
      await check(connection);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Sign-in could not be completed."); }
    finally { setBusy(false); }
  }
  const selected = nativeSelection(), active = selected?.connection === id && selected?.model === model;
  const progress: Record<string, string> = { starting: "Preparing sign-in…", "awaiting-code": "Waiting for your sign-in code", connecting: "Connecting…", "loading-models": "Loading models…", verifying: "Checking connection…", busy: "Another administrator is connecting this account", expired: "Sign-in expired. Start again.", cancelled: "Sign-in cancelled." };
  const error = messages[signIn?.error || status?.reason || ""];
  return <section className={`settings-card native-provider-card native-provider-card--${provider}`} aria-label={`${name} model provider`}>
    <div className="settings-card__heading"><div><span>{connection && connection.scope !== "personal" ? connection.label : "Model provider"}</span><h2>{name}</h2>
      <p>{provider === "claude" ? "Sign in to your Claude account, then paste the code here. We'll load your models and send a tiny test request to check the connection." : "Connect your ChatGPT account with a one-time code. Models load automatically."}</p></div></div>
    <p role="status">{connection?.enabled === false ? "Paused" : status?.ready ? active ? "Connected · ready for chats" : "Connected" : reconnect ? "Reconnect required" : progress[stage || ""] || (pending ? "Waiting for sign-in" : "Not connected")}</p>
    {error && <p role="alert">{error}</p>}
    {!canManage && <p>An administrator needs to reconnect this account.</p>}
    {canManage && !status?.ready && (!pending || provider === "codex") && !retryVerification && <button className="settings-button is-primary" disabled={busy || connection?.enabled === false} onClick={() => void start()}>{reconnect ? "Reconnect Anthropic" : stage === "expired" || stage === "failed" || stage === "cancelled" ? "Start again" : `Connect ${name}`}</button>}
    {pending && signIn?.verificationUrl && <a className="settings-button" href={openedUrl.current === signIn.verificationUrl ? signIn.verificationUrl : undefined} target="_blank" rel="noreferrer">Open {name}</a>}
    {provider === "codex" && pending && signIn?.userCode && <p>Enter this one-time code on OpenAI: <code>{signIn.userCode}</code><button className="settings-button" onClick={() => {
      if (!navigator.clipboard?.writeText) { setNotice("Copy the code shown above."); return; }
      void navigator.clipboard.writeText(signIn.userCode!).catch(() => setNotice("Copy the code shown above."));
    }}>Copy code</button></p>}
    {provider === "claude" && stage === "awaiting-code" && canManage && <form onSubmit={event => { event.preventDefault(); void action("account.submit"); }}>
      <label>Paste the code from Anthropic<input type="password" autoComplete="off" spellCheck={false} maxLength={4096} value={code} onChange={event => setCode(event.target.value)} autoFocus /></label>
      <button className="settings-button is-primary" disabled={busy || !code.trim()}>Connect</button>
    </form>}
    {canManage && pending && stage !== "busy" && <button className="settings-button" disabled={busy} onClick={() => void action("account.cancel")}>Cancel sign-in</button>}
    {retryVerification && canManage && <button className="settings-button is-primary" disabled={busy} onClick={() => void action("account.verify")}>Check again</button>}
    {status?.ready && <div className="native-provider-ready"><label>{name} model<select value={model} disabled={!catalog || busy} onChange={event => {
      setModel(event.target.value); onModel?.(event.target.value); if (connection && autoActivate) void onSelect({ connection: connection.id, model: event.target.value }, connection.generation).catch(() => setNotice("Model selection could not be saved. Try again."));
    }}><option value="">Choose a model</option>{catalog?.models.map(row => <option key={row.id} value={row.id} disabled={!row.available}>{row.name}</option>)}</select></label>
      {autoActivate && !active && model && connection && <button className="settings-button" onClick={() => void onSelect({ connection: connection.id, model }, connection.generation).catch(() => setNotice("The model selection could not be saved. Try again."))}>Use for my chats</button>}
      {autoActivate && active && <button className="settings-button is-primary" onClick={() => window.dispatchEvent(new CustomEvent("neural-labs-open-chat"))}>Open Alshival</button>}
      <small>Models update automatically while Settings is open.</small>
      <details><summary>Connection options</summary><button className="settings-button" onClick={() => connection && void loadModels(connection).catch(() => setNotice("Models could not be loaded. Try again."))}>Reload models</button>
        {canManage && <button className="settings-button" onClick={() => void start()}>Reconnect {name}</button>}</details>
    </div>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
