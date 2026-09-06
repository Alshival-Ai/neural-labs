import { ArrowLeft, Check, Clipboard, ExternalLink, MessageSquareText, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { settingsMutationHeaders, settingsRequest, type TwilioPluginStatus } from "./settingsApi";
import "./twilio-plugin.css";

export function TwilioPluginCard({ initial, csrfToken, detailOnly = false, onBack, onStatus }: { initial: TwilioPluginStatus; csrfToken: string; detailOnly?: boolean; onBack?: () => void; onStatus?: (status: TwilioPluginStatus) => void }) {
  const [status, updateStatus] = useState(initial);
  const setStatus = (next: TwilioPluginStatus) => { updateStatus(next); onStatus?.(next); };
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { updateStatus(initial); }, [initial]);

  async function probe() {
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await settingsRequest<TwilioPluginStatus>("/api/admin/plugins/twilio/probe", {
        method: "POST", headers: settingsMutationHeaders(csrfToken), body: "{}",
      });
      setStatus(next);
      setNotice(next.webhookVerified ? "Twilio is configured for this webhook." : "Connection works. Finish the webhook steps below in Twilio.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not check Twilio."); }
    finally { setBusy(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const next = await settingsRequest<TwilioPluginStatus>("/api/admin/plugins/twilio", {
        method: "PUT",
        headers: settingsMutationHeaders(csrfToken),
        body: JSON.stringify({
          accountSid: String(data.get("accountSid") ?? ""),
          authToken: String(data.get("authToken") ?? ""),
          fromNumber: String(data.get("fromNumber") ?? ""),
        }),
      });
      setStatus(next); setNotice("Twilio credentials validated and saved.");
      form.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save Twilio."); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Twilio SMS/MMS for this workspace?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      setStatus(await settingsRequest<TwilioPluginStatus>("/api/admin/plugins/twilio", {
        method: "DELETE", headers: settingsMutationHeaders(csrfToken),
      }));
      setNotice("Twilio disconnected.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not disconnect Twilio."); }
    finally { setBusy(false); }
  }

  if (!details && !detailOnly) {
    return <button className="twilio-plugin-card" type="button" onClick={() => setDetails(true)}>
      <span className="twilio-plugin-card__mark"><MessageSquareText /></span>
      <span className="twilio-plugin-card__copy"><small>Global channel · SMS/MMS</small><strong>{status.name}</strong><span>{status.description}</span></span>
      <span className={`twilio-plugin-card__state${status.ready ? " is-ready" : ""}`}><i />{status.ready ? "Connected" : "Set up"}</span>
    </button>;
  }

  return <section className="twilio-plugin-detail">
    <button className="settings-back-button" type="button" onClick={() => onBack ? onBack() : setDetails(false)}><ArrowLeft />All plugins</button>
    <header><div className="twilio-plugin-detail__mark"><MessageSquareText /></div><div><span>Global channel plugin</span><h2>Twilio SMS/MMS</h2><p>One workspace sender. Verified members can text their private Neura; proactive messages require each member’s opt-in.</p></div></header>
    {error && <p className="settings-error-note" role="alert">{error}</p>}
    {notice && <p className="settings-success-note" role="status"><Check />{notice}</p>}
    <div className="twilio-plugin-detail__grid">
      <section className="settings-card">
        <div className="settings-card__heading"><div><span>Connection</span><h2>{status.configured ? "Manage Twilio" : "Connect Twilio"}</h2><p>The Auth Token is encrypted and is never returned to this page.</p></div><ShieldCheck /></div>
        {status.editable ? <form className="twilio-plugin-form" onSubmit={(event) => void save(event)}>
          <label>Account SID<input name="accountSid" defaultValue="" placeholder={status.accountSidHint ?? "AC…"} autoComplete="off" required={!status.configured} /></label>
          <label>Auth Token<input name="authToken" type="password" autoComplete="new-password" placeholder={status.configured ? "Leave blank to keep current token" : "Required"} required={!status.configured} /></label>
          <label>Twilio sender number<input name="fromNumber" type="tel" defaultValue={status.fromNumber ?? ""} placeholder="+1 956 555 0123" required /></label>
          <div><button className="settings-button is-primary" disabled={busy}>{busy ? "Validating…" : "Validate and save"}</button>{status.configured && <button className="settings-button" type="button" disabled={busy} onClick={() => void probe()}><RefreshCw />Check setup</button>}</div>
        </form> : <p className="settings-card-note">Only a workspace administrator can change this connection.</p>}
        {status.error && <p className="settings-error-note">{status.error}</p>}
      </section>
      <section className="settings-card">
        <div className="settings-card__heading"><div><span>Twilio Console</span><h2>Configure inbound messages</h2><p>V1 provides the exact steps; Neural Labs does not modify Twilio settings.</p></div><Smartphone /></div>
        <ol className="twilio-plugin-steps"><li>Open <strong>Phone Numbers → Manage → Active numbers</strong> in Twilio.</li><li>Select <strong>{status.fromNumber ?? "your Neural Labs sender number"}</strong>.</li><li>Under Messaging, set <strong>A message comes in</strong> to Webhook.</li><li>Choose <strong>HTTP POST</strong> and paste the URL below.</li><li>Save, then return here and choose <strong>Check setup</strong>.</li></ol>
        <div className="twilio-plugin-webhook"><code>{status.webhookUrl}</code><button type="button" onClick={() => void navigator.clipboard.writeText(status.webhookUrl)}><Clipboard />Copy</button></div>
        <a className="settings-button" href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noreferrer">Open Twilio Console <ExternalLink /></a>
      </section>
    </div>
    <div className="twilio-plugin-capabilities"><span className={status.smsCapable === false ? "is-off" : ""}>SMS {status.smsCapable === false ? "unavailable" : "supported"}</span><span className={status.mmsCapable === false ? "is-off" : ""}>MMS {status.mmsCapable === false ? "unavailable" : "supported"}</span><span className={status.webhookVerified ? "is-ready" : ""}>Webhook {status.webhookVerified ? "verified" : "not checked"}</span></div>
    {status.editable && status.configured && <button className="settings-button is-danger" type="button" disabled={busy} onClick={() => void disconnect()}>Disconnect Twilio</button>}
  </section>;
}
