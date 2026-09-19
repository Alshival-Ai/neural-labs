import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { settingsMutationHeaders, settingsRequest } from "./settingsApi";

function nonceAwareDocument(source: Document): Document {
  const nonce = source.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
  if (!nonce) return source;
  return new Proxy(source, { get(target, property) {
    if (property === "createElement") return ((tag: string, options?: ElementCreationOptions) => { const element = target.createElement(tag, options); if (tag.toLowerCase() === "style") element.setAttribute("nonce", nonce); return element; }) as Document["createElement"];
    const value = Reflect.get(target, property, target) as unknown;
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

export type ClaudeConnection = { provider: "anthropic"; authMethod: "subscription" | "api-key"; agentId: string; authenticated: boolean; modelReady: boolean; paused: boolean; state: "disconnected" | "connected" | "awaiting_user" | "error"; message?: string | null; attemptId?: string };
export function ClaudeProviderConnection({ csrfToken, workload, onStatusChange }: { csrfToken: string; workload?: "team" | "background"; onStatusChange?: (status: ClaudeConnection) => void }) {
  const base = `/api/${workload ? "admin/workspace" : "account"}/model-providers/anthropic/connection`;
  const suffix = workload ? `?workload=${workload}` : "";
  const [status, setStatus] = useState<ClaudeConnection>();
  const [attempt, setAttempt] = useState<string>();
  const [loginUrl, setLoginUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [key, setKey] = useState("");
  const [keyForm, setKeyForm] = useState(false);
  const mutationGeneration = useRef(0);
  const terminalHost = useRef<HTMLDivElement>(null);
  const callback = useRef(onStatusChange); callback.current = onStatusChange;
  const headers = () => settingsMutationHeaders(csrfToken);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const generation = mutationGeneration.current;
      try {
        const next = await settingsRequest<ClaudeConnection>(base + suffix);
        if (active && generation === mutationGeneration.current) { setStatus(next); callback.current?.(next); if (next.state !== "awaiting_user") setAttempt(undefined); }
      } catch { if (active && generation === mutationGeneration.current) setError("Claude connection could not be checked."); }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), attempt ? 2000 : 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [base, suffix, attempt]);
  useEffect(() => {
    setLoginUrl(undefined);
    if (!attempt || !terminalHost.current) return;
    const terminal = new Terminal({ documentOverride: nonceAwareDocument(document), cols: 90, rows: 20, convertEol: true, fontSize: 13, theme: { background: "#171717", foreground: "#eeeeee" } });
    terminal.open(terminalHost.current);
    let stopped = false, cursor = 0, pending = Promise.resolve();
    const exchange = (data?: string) => {
      pending = pending.then(async () => {
        if (stopped) return;
        try {
          const result = await settingsRequest<{ output: string; cursor: number; verificationUrl?: string | null }>(`${base}/terminal${suffix}`, { method: "POST", headers: headers(), body: JSON.stringify({ attemptId: attempt, cursor, ...(data === undefined ? {} : { data }) }) });
          if (!stopped) { terminal.write(result.output); cursor = result.cursor; if (result.verificationUrl) setLoginUrl(result.verificationUrl); }
        } catch {
          try {
            const next = await settingsRequest<ClaudeConnection>(base + suffix);
            if (!stopped) {
              setStatus(next); callback.current?.(next);
              if (next.state !== "awaiting_user") { setAttempt(undefined); setError(undefined); }
              else setError("The sign-in session could not be reached. Use Continue Claude sign-in to reopen it.");
            }
          } catch { if (!stopped) setError("The sign-in session could not be reached. Refresh the connection and try again."); }
        }
      });
    };
    const input = terminal.onData(data => exchange(data));
    const timer = window.setInterval(() => exchange(), 750); exchange(); terminal.focus();
    return () => { stopped = true; clearInterval(timer); input.dispose(); terminal.dispose(); };
  }, [attempt, base, suffix, csrfToken]);
  async function action(name: string) {
    mutationGeneration.current += 1;
    setBusy(true); setError(undefined);
    try {
      const result = await settingsRequest<ClaudeConnection>(`${base}/${name}${suffix}`, { method: "POST", headers: headers(), body: JSON.stringify(name === "api-key" ? { key } : {}) });
      setStatus(result); callback.current?.(result); setAttempt(result.attemptId); setConfirm(false);
      if (name === "api-key") { setKey(""); setKeyForm(false); }
    } catch (error) { setError(error instanceof Error ? error.message : "Claude connection could not be updated."); }
    finally { setBusy(false); }
  }
  const title = workload === "team" ? "Team Neura Claude connection" : workload === "background" ? "Background AI Claude connection" : "Your Claude account";
  return <section className="settings-card claude-provider-card">
    <div className="settings-card__heading"><div><h2>{title}</h2><p>{workload ? "A separate workspace-owned connection for this workload." : "Use your Claude account for private Neura chats and manual automation runs."}</p></div></div>
    <p role="status">{!status ? "Checking connection…" : status.state === "awaiting_user" ? "Sign-in in progress" : status.authenticated ? `${status.authMethod === "api-key" ? "API key configured" : "Claude connected"}${status.paused ? " · paused" : !status.modelReady ? " · model setup pending" : ""}` : "Not connected"}</p>
    {!attempt && <button className="settings-button is-primary" disabled={busy} onClick={() => void action("connect")}>{status?.state === "awaiting_user" ? "Continue Claude sign-in" : status?.authenticated ? "Reconnect Claude" : "Connect Claude"}</button>}
    {attempt && <div className="claude-login">
      <p>Open the Anthropic sign-in link shown below in your browser. If Anthropic returns a login code, paste it into the native prompt below. Keep this page open until sign-in finishes.</p>
      {loginUrl && <a className="settings-button is-primary" href={loginUrl} target="_blank" rel="noreferrer">Open Anthropic sign-in</a>}
      <div ref={terminalHost} className="claude-login-terminal" role="region" aria-label="Native Claude sign-in terminal" />
      <button className="settings-button" disabled={busy} onClick={() => void action("cancel")}>Cancel sign-in</button>
    </div>}
    {status?.authenticated && !attempt && <>
      <button className="settings-button" disabled={busy} onClick={() => void action(status.paused ? "resume" : "pause")}>{status.paused ? "Resume Claude" : "Pause Claude"}</button>
      <button className="settings-button" disabled={busy} onClick={() => setConfirm(true)}>Disconnect Claude</button>
    </>}
    {confirm && <div><p>Disconnect this Claude connection? Chats and saved model selections remain. Requests using this connection will require reconnection.</p><button className="settings-button" disabled={busy} onClick={() => void action("disconnect")}>Confirm disconnect Claude</button><button className="settings-button" onClick={() => setConfirm(false)}>Keep connected</button></div>}
    <button className="settings-button" disabled={busy || !!attempt} onClick={() => void action("refresh")}>Refresh Claude connection</button>
    {workload && !attempt && <div>
      <button className="settings-button" disabled={busy} onClick={() => setKeyForm(!keyForm)}>Use a workspace API key</button>
      {keyForm && <form onSubmit={event => { event.preventDefault(); void action("api-key"); }}><p>API usage is billed separately from Claude subscriptions. Saving selects API-key authentication for this workload.</p><label>Anthropic API key<input type="password" autoComplete="off" value={key} maxLength={4096} onChange={event => setKey(event.target.value)} /></label><button className="settings-button" disabled={busy || !key.trim()}>Save and use API key</button></form>}
    </div>}
    <p className="settings-trust-note">Claude manages subscription sign-in and refresh inside this instance. No additional public DNS or callback port is required. Connecting does not change saved model defaults.</p>
    {(error || status?.message) && <p role="alert">{error || status?.message}</p>}
  </section>;
}
