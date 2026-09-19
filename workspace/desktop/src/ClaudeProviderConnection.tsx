import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
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
  const [terminalConnected, setTerminalConnected] = useState(false);
  const [terminalRevision, setTerminalRevision] = useState(0);
  const [loginCode, setLoginCode] = useState("");
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const sendInput = useRef<(data: string) => boolean>(() => false);
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
    void refresh(); const timer = window.setInterval(() => void refresh(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [base, suffix, attempt]);
  useEffect(() => {
    setLoginUrl(undefined); setLoginCode(""); setTerminalConnected(false);
    const host = terminalHost.current;
    if (!attempt || !host) return;
    const terminal = new Terminal({ documentOverride: nonceAwareDocument(host.ownerDocument), cols: 90, rows: 20, disableStdin: true, convertEol: true, fontSize: 13, theme: { background: "#171717", foreground: "#eeeeee" } });
    const fit = new FitAddon(); terminal.loadAddon(fit);
    terminal.open(host); terminalRef.current = terminal;
    let stopped = false, socket: WebSocket | undefined, ready = false;
    const write = (message: object) => {
      if (stopped || !ready || socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message)); return true;
    };
    sendInput.current = data => write({ type: "input", data });
    const resize = () => {
      if (host.clientWidth < 20 || host.clientHeight < 20) return;
      fit.fit();
      write({ type: "resize", cols: Math.max(20, Math.min(240, terminal.cols)), rows: Math.max(6, Math.min(100, terminal.rows)) });
    };
    const observer = new ResizeObserver(resize); observer.observe(host);
    const input = terminal.onData(data => { if (!sendInput.current(data)) setError("Reconnect the sign-in terminal before entering the code."); });
    const refreshAfterClose = async () => {
      try {
        const next = await settingsRequest<ClaudeConnection>(base + suffix);
        if (stopped) return;
        setStatus(next); callback.current?.(next);
        if (next.state !== "awaiting_user") { setAttempt(undefined); setError(undefined); }
        else setError("The sign-in terminal disconnected. Reconnect it before entering the code.");
      } catch { if (!stopped) setError("The sign-in terminal disconnected. Reconnect it to continue."); }
    };
    void (async () => {
      try {
        const ticket = await settingsRequest<{ ticket: string; path: string; protocol: string }>(`${base}/terminal-ticket${suffix}`, { method: "POST", headers: headers(), body: JSON.stringify({ attemptId: attempt }) });
        if (stopped) return;
        const url = new URL(ticket.path, window.location.origin); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(url, [ticket.protocol, `ticket.${ticket.ticket}`]);
        socket.onmessage = event => {
          if (stopped) return;
          try {
            const message = JSON.parse(String(event.data));
            if (message.type === "ready" || message.type === "output") {
              if (typeof message.data === "string") terminal.write(message.data);
              if (typeof message.verificationUrl === "string") setLoginUrl(message.verificationUrl);
              if (message.type === "ready") {
                ready = true; terminal.options.disableStdin = false; setTerminalConnected(true); setError(undefined); resize(); terminal.focus();
              }
            } else if (message.type === "finished") { ready = false; terminal.options.disableStdin = true; setTerminalConnected(false); }
          } catch { setError("The sign-in terminal received an invalid response. Reconnect it to continue."); socket?.close(); }
        };
        socket.onclose = () => {
          if (stopped) return;
          ready = false; terminal.options.disableStdin = true; setTerminalConnected(false);
          void refreshAfterClose();
        };
        socket.onerror = () => { if (!stopped) setError("The sign-in terminal could not connect. Reconnect it to continue."); };
      } catch { if (!stopped) { setError("The sign-in terminal could not connect. Reconnect it to continue."); void refreshAfterClose(); } }
    })();
    return () => {
      stopped = true; ready = false; sendInput.current = () => false; terminalRef.current = undefined;
      if (socket) { socket.onmessage = null; socket.onclose = null; socket.onerror = null; socket.close(); }
      observer.disconnect(); input.dispose(); terminal.dispose();
    };
  }, [attempt, base, suffix, csrfToken, terminalRevision]);
  async function pasteCode() {
    const terminal = terminalRef.current;
    try {
      const text = await navigator.clipboard.readText();
      if (terminal && terminal === terminalRef.current && !terminal.options.disableStdin) {
        terminal.paste(text); terminal.focus(); setError(undefined);
      }
    } catch { setError("Clipboard access is unavailable. Paste into the Sign-in code field below, then choose Send code."); }
  }
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
      <p>Open the Anthropic sign-in link shown below in your browser. If Anthropic returns a login code, paste it into the terminal or the Sign-in code field below. Keep this page open until sign-in finishes.</p>
      {loginUrl && <a className="settings-button is-primary" href={loginUrl} target="_blank" rel="noreferrer">Open Anthropic sign-in</a>}
      <div ref={terminalHost} className="claude-login-terminal" role="region" aria-label="Native Claude sign-in terminal" />
      <div className="claude-login-actions">
        <button className="settings-button" disabled={!terminalConnected} onClick={() => void pasteCode()}>Paste into terminal</button>
        <button className="settings-button" disabled={!terminalConnected} onClick={() => { sendInput.current("\r"); terminalRef.current?.focus(); }}>Enter</button>
        {!terminalConnected && <button className="settings-button" onClick={() => setTerminalRevision(value => value + 1)}>Reconnect sign-in terminal</button>}
      </div>
      <form className="claude-login-code" onSubmit={event => {
        event.preventDefault();
        if (loginCode.trim() && sendInput.current(`${loginCode.trim()}\r`)) { setLoginCode(""); setError(undefined); }
        else setError("Reconnect the sign-in terminal before sending the code.");
      }}>
        <label>Sign-in code<input type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={8192} value={loginCode} onChange={event => setLoginCode(event.target.value)} /></label>
        <button className="settings-button" disabled={!terminalConnected || !loginCode.trim()}>Send code</button>
      </form>
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
