import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Mail, MessageSquare, RefreshCw, X } from "lucide-react";
import { settingsRequest, settingsMutationHeaders, type TwilioPluginStatus } from "./settingsApi";
import { nativeRequest, type NativeConnection } from "./nativeApi";
import type { ProviderCatalog } from "./modelProviders";
import "./connectors.css";

type Provider = "gmail" | "outlook";
type Status = { mailbox:{provider:Provider|null;address:string|null;connected:boolean;paused:boolean;lastSync:string|null;error:string|null};sms:TwilioPluginStatus & {enabled:boolean;statusCallbackUrl:string};selection:{connection:string;generation:number;model:string}|null;providers:Array<{provider:Provider;available:boolean;callbackUrl:string}> };
type Preferences = {emailEnabled:boolean;emailVerified:boolean;smsEnabled:boolean;smsVerified:boolean;smsOptedOut:boolean};
const names = {gmail:"Gmail",outlook:"Outlook"};
export type MessagingView = "gmail" | "outlook" | "twilio" | "messaging";
export function ConnectorsPanel({administrator,csrfToken,view="all"}:{administrator:boolean;csrfToken:string;view?:MessagingView|"all"}) {
  const shared = view === "all" || view === "messaging";
  const title = view === "gmail" ? "Gmail" : view === "outlook" ? "Outlook" : view === "twilio" ? "Twilio" : "Messaging settings";
  const [status,setStatus]=useState<Status>();const [preferences,setPreferences]=useState<Preferences>();const [error,setError]=useState("");const [busy,setBusy]=useState(false);const pending=useRef(false);
  const [connections,setConnections]=useState<NativeConnection[]>([]);const [connection,setConnection]=useState("");const [model,setModel]=useState("");const [models,setModels]=useState<string[]>([]);
  const [code,setCode]=useState("");const [codeSent,setCodeSent]=useState(false);const [notice,setNotice]=useState("");
  const refresh=useCallback(async()=>{const [s,p]=await Promise.all([settingsRequest<Status>("/api/connectors"),settingsRequest<Preferences>("/api/connectors/preferences")]);setStatus(s);setPreferences(p);},[]);
  useEffect(()=>{void refresh().catch(e=>setError(e.message));if(administrator&&shared)void settingsRequest<{connections:NativeConnection[]}>("/api/runtime/connections").then(r=>setConnections(r.connections.filter(c=>c.scope!=="personal"&&c.enabled))).catch(e=>setError(e.message));
    const timer=window.setInterval(()=>void refresh().catch(()=>{}),10000);const focus=()=>void refresh().catch(()=>{});window.addEventListener("focus",focus);return()=>{clearInterval(timer);window.removeEventListener("focus",focus);};},[administrator,shared,refresh]);
  const mutate=async(url:string,body:unknown={},method="POST")=>settingsRequest(url,{method,headers:settingsMutationHeaders(csrfToken),...(method!=="DELETE"?{body:JSON.stringify(body)}:{})});
  const act=async(work:()=>Promise<unknown>)=>{if(pending.current)return;pending.current=true;setBusy(true);setError("");setNotice("");try{await work();window.dispatchEvent(new Event("neural-labs:plugins-changed"));await refresh();}catch(e){setError(e instanceof Error?e.message:"Could not update plugin.");}finally{pending.current=false;setBusy(false);}};
  const connect=async(provider:Provider)=>{
    if(status?.mailbox.connected&&!window.confirm(`Replace ${status.mailbox.address} with a ${names[provider]} mailbox? Existing history is retained.`))return;
    // Open synchronously so browsers don't block the consent tab after the request.
    const tab=window.open("about:blank","_blank");if(tab)tab.opener=null;
    await act(async()=>{try{const result=await settingsRequest<{url:string}>(`/api/admin/connectors/oauth/${provider}/start`,{method:"POST",headers:settingsMutationHeaders(csrfToken),body:JSON.stringify({replace:!!status?.mailbox.connected})});if(tab)tab.location.href=result.url;else{setNotice("Allow pop-ups, then click Connect again.");}}catch(e){tab?.close();throw e;}});
  };
  return <section className="connectors-panel" aria-label={title}>
    <header><h1>{title}</h1><p>Give Alshival a workspace mailbox and phone number. Conversations stay private to each member.</p></header>
    {error&&<p role="alert" className="settings-notice is-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!status&&<p>Loading connectors…</p>}
    {status&&<>
      {administrator&&shared&&<section className="connector-card"><h2>Workspace agent</h2><p>Handles incoming messages while you’re away. Connect a workspace account in Model Provider first.</p>
        <p>{status.selection?`Current model: ${status.selection.model}`:"Choose a workspace AI connection to enable replies."}</p>
        <div className="connector-actions"><label>AI connection<select value={connection} onChange={e=>{setConnection(e.target.value);setModels([]);setModel("");}}><option value="">Choose connection</option>{connections.map(c=><option key={c.id} value={c.id}>{c.label} · {c.provider}</option>)}</select></label>
          <button className="settings-button" disabled={busy||!connection} onClick={()=>void act(async()=>{const result=await nativeRequest<ProviderCatalog>("models.list",{},{connection,model:"catalog"});const entries=result.models.map(m=>m.id);setModels(entries);setModel(entries[0]||"");})}>Load models</button>
          {!!models.length&&<><label>Model<select value={model} onChange={e=>setModel(e.target.value)}>{models.map(m=><option key={m}>{m}</option>)}</select></label><button className="settings-button is-primary" disabled={busy||!model} onClick={()=>void act(()=>mutate("/api/admin/connectors/model",{connection,generation:connections.find(c=>c.id===connection)!.generation,model},"PUT"))}>Use for messaging</button></>}
        </div>
      </section>}
      <div className="connector-grid">{status.providers.filter(provider=>view==="all"||view===provider.provider).map(provider=>{const selected=status.mailbox.provider===provider.provider;return <section className="connector-card" key={provider.provider} aria-label={`${names[provider.provider]} plugin`}>
        <header><Mail/><h2>{view==="all"?names[provider.provider]:"Mailbox connection"}</h2></header><p>One workspace mailbox for email conversations and agent updates.</p>
        <strong>{selected?status.mailbox.address: "Not connected"}</strong>{selected&&<p>{status.mailbox.paused?"Paused":"Connected"}{status.mailbox.lastSync?` · Synced ${new Date(status.mailbox.lastSync).toLocaleTimeString()}`:""}</p>}
        {selected&&status.mailbox.error&&<p role="status">Needs attention: {status.mailbox.error.replaceAll("_"," ")}</p>}
        {administrator&&<>
          {!provider.available&&<p>Configure your provider OAuth application below to enable sign-in.</p>}
          <div className="connector-actions"><button className="settings-button is-primary" disabled={busy||!provider.available} onClick={()=>void connect(provider.provider)}>{selected?"Reconnect":"Connect"}</button>
            {selected&&<><button className="settings-button" disabled={busy} onClick={()=>void act(()=>mutate("/api/admin/connectors/email/enabled",{enabled:status.mailbox.paused},"PUT"))}>{status.mailbox.paused?"Resume":"Pause"}</button><button className="settings-button" disabled={busy} onClick={()=>{if(window.confirm("Disconnect this workspace mailbox? Message history is retained."))void act(()=>mutate("/api/admin/connectors/mailbox",{},"DELETE"));}}>Disconnect</button></>}
          </div>
          <details><summary>OAuth application setup</summary><p>Register this exact redirect URL with {names[provider.provider]}:</p><code className="connector-url">{provider.callbackUrl}</code>
            <p>{provider.provider==="gmail"?"Enable Gmail API and request Gmail read-only and send access. Configure the consent screen for your intended users.":"Register a web application supporting your account type, with delegated User.Read, Mail.Read, Mail.Send and offline_access permissions."}</p>
            <form onSubmit={e=>{e.preventDefault();const f=e.currentTarget;const data=new FormData(f);void act(async()=>{await mutate(`/api/admin/connectors/oauth/${provider.provider}`,{clientId:data.get("clientId"),clientSecret:data.get("clientSecret")},"PUT");f.reset();});}}>
              <label>Client ID<input name="clientId" required autoComplete="off"/></label><label>Client secret<input name="clientSecret" type="password" required autoComplete="new-password"/></label><button className="settings-button" disabled={busy}>Save application</button>
            </form>
          </details>
        </>}
      </section>;})}
      {(view==="all"||view==="twilio")&&<TwilioConnector status={status} administrator={administrator} busy={busy} act={act} mutate={mutate}/>}</div>
      {shared&&preferences&&<section className="connector-card"><h2>Your messaging preferences</h2><p>Only verified members can message the agent. Enabling a channel allows automatic replies and proactive updates, including from automations.</p>
        {!preferences.emailVerified&&<><button className="settings-button" disabled={busy||!status.mailbox.connected||status.mailbox.paused} onClick={()=>void act(async()=>{await mutate("/api/connectors/email/verify/start");setCodeSent(true);})}>Verify my email</button>{codeSent&&<form onSubmit={e=>{e.preventDefault();void act(()=>mutate("/api/connectors/email/verify/finish",{code}));}}><label>Email verification code<input value={code} onChange={e=>setCode(e.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required/></label><button className="settings-button" disabled={busy}>Verify code</button></form>}</>}
        <label className="connector-toggle"><input type="checkbox" checked={preferences.emailEnabled} disabled={busy||!preferences.emailVerified} onChange={e=>void act(()=>mutate("/api/connectors/preferences",{email:e.target.checked,sms:preferences.smsEnabled},"PUT"))}/>Email conversations and updates</label>
        {!preferences.smsVerified&&<p>Verify your phone in Personalization and enable Agent SMS updates first.</p>}{preferences.smsOptedOut&&<p>You opted out. Text START to {status.sms.fromNumber} to allow SMS again.</p>}
        <label className="connector-toggle"><input type="checkbox" checked={preferences.smsEnabled} disabled={busy||!preferences.smsVerified||preferences.smsOptedOut} onChange={e=>void act(()=>mutate("/api/connectors/preferences",{email:preferences.emailEnabled,sms:e.target.checked},"PUT"))}/>SMS conversations and updates</label>
      </section>}
      {administrator&&shared&&<section className="connector-card"><h2>Send a connection test</h2><p>Sends one real message to a verified, opted-in workspace member.</p><form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void act(async()=>{await mutate("/api/admin/connectors/test",{channel:data.get("channel"),member:data.get("member"),requestId:crypto.randomUUID()});setNotice("Test message queued. Check private Email & SMS history for delivery status.");});}}><div className="connector-actions"><label>Channel<select name="channel"><option value="email">Email</option><option value="sms">SMS</option></select></label><label>Member handle<input name="member" placeholder="@member" required/></label><button className="settings-button" disabled={busy}>Send test message</button></div></form></section>}
    </>}
  </section>;
}
function TwilioConnector({status,administrator,busy,act,mutate}:{status:Status;administrator:boolean;busy:boolean;act:(work:()=>Promise<unknown>)=>Promise<void>;mutate:(url:string,body?:unknown,method?:string)=>Promise<unknown>}) {
  const [accountSid,setSid]=useState("");const [authToken,setToken]=useState("");const [number,setNumber]=useState(status.sms.fromNumber||"");const [numbers,setNumbers]=useState<Array<{number:string;label:string}>>([]);
  return <section className="connector-card" aria-label="Twilio plugin"><header><MessageSquare/><h2>Twilio SMS</h2></header><p>A workspace number for private conversations and agent updates.</p><strong>{status.sms.fromNumber||"Not connected"}</strong><p>{status.sms.enabled?"Enabled":"Paused"}</p>
    {administrator&&<><form onSubmit={e=>{e.preventDefault();void act(async()=>{await mutate("/api/admin/connectors/twilio",{accountSid,authToken,fromNumber:number},"PUT");setToken("");});}}>
      <label>Account SID<input value={accountSid} onChange={e=>setSid(e.target.value)} placeholder={status.sms.accountSidHint||"AC…"} autoComplete="off"/></label><label>Auth token<input type="password" value={authToken} onChange={e=>setToken(e.target.value)} autoComplete="new-password" placeholder={status.sms.configured?"Leave blank to keep saved token":""}/></label>
      <button type="button" className="settings-button" disabled={busy||!accountSid||!authToken} onClick={()=>void act(async()=>{const result=await mutate("/api/admin/connectors/twilio/numbers",{accountSid,authToken}) as {numbers:Array<{number:string;label:string}>};setNumbers(result.numbers);if(!number)setNumber(result.numbers[0]?.number||"");})}>Load my numbers</button>
      <label>Sender number{numbers.length?<select value={number} onChange={e=>setNumber(e.target.value)}>{numbers.map(n=><option key={n.number} value={n.number}>{n.number} · {n.label}</option>)}</select>:<input value={number} onChange={e=>setNumber(e.target.value)} placeholder="+15551234567" required/>}</label><button className="settings-button is-primary" disabled={busy||!number}>Save connection</button>
    </form><p>Incoming webhook (POST)</p><code className="connector-url">{status.sms.webhookUrl}</code><p>Delivery callback</p><code className="connector-url">{status.sms.statusCallbackUrl}</code>
      {status.sms.configured&&<div className="connector-actions"><button className="settings-button" disabled={busy} onClick={()=>void act(()=>mutate("/api/admin/plugins/twilio/probe"))}>Check setup</button><button className="settings-button" disabled={busy} onClick={()=>void act(()=>mutate("/api/admin/connectors/twilio/configure"))}>Configure webhooks</button><button className="settings-button" disabled={busy} onClick={()=>void act(()=>mutate("/api/admin/connectors/sms/enabled",{enabled:!status.sms.enabled},"PUT"))}>{status.sms.enabled?"Pause":"Enable SMS"}</button><button className="settings-button" disabled={busy} onClick={()=>{if(window.confirm("Disconnect the workspace Twilio account?"))void act(()=>mutate("/api/admin/connectors/twilio",{},"DELETE"));}}>Disconnect</button></div>}
    </>}
  </section>;
}
export function ConnectorInbox({csrfToken,onClose}:{csrfToken:string;onClose:()=>void}) {
  const [messages,setMessages]=useState<Array<{id:string;channel:string;direction:string;subject:string;body:string;status:string;error:string|null;created_at:string}>>([]);const [error,setError]=useState("");
  const refresh=useCallback(async()=>{try{const result=await settingsRequest<{messages:typeof messages}>("/api/connectors/messages");setMessages(result.messages);setError("");}catch(e){setError(e instanceof Error?e.message:"Could not load messages.");}},[]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[refresh]);
  return <section className="connector-inbox" aria-label="Your email and SMS"><header><div><h2>Email &amp; SMS</h2><p>Only your conversations appear here.</p></div><button className="settings-button" onClick={()=>void refresh()} aria-label="Refresh messages"><RefreshCw size={16}/></button><button className="settings-button" onClick={onClose} aria-label="Close messages"><X size={16}/></button></header>
    {error&&<p role="alert">{error}</p>}{!messages.length&&<p>Connect your workspace mailbox or number in Settings → Plugins, then enable your preferences in Messaging settings.</p>}
    <div className="connector-message-list">{messages.map(m=><article key={m.id} className={`connector-message is-${m.direction}`}><small>{m.channel.toUpperCase()} · {m.direction==="in"?"You":"Alshival"} · {new Date(m.created_at).toLocaleString()}</small>{m.subject&&<h3>{m.subject}</h3>}<p>{m.body}</p><small>{m.status}{m.error?` · ${m.error}`:""}</small>{m.direction==="in"&&m.status==="held"&&<button className="settings-button" onClick={()=>void settingsRequest(`/api/connectors/messages/${m.id}/resume`,{method:"POST",headers:settingsMutationHeaders(csrfToken),body:"{}"}).then(refresh).catch(e=>setError(e.message))}>Resume when ready</button>}</article>)}</div>
  </section>;
}

export function MailboxPluginCards({administrator,onSelect}:{administrator:boolean;onSelect:(view:MessagingView)=>void}) {
  const [status,setStatus]=useState<Status>(); const [error,setError]=useState("");
  const refresh=useCallback(async()=>{
    try {
      const next=await settingsRequest<Status>("/api/connectors");
      if(!Array.isArray(next.providers)||!next.mailbox)throw new Error("Mailbox status unavailable");
      setStatus(next);setError("");
    } catch { setError("Mailbox status unavailable. Open a plugin to retry."); }
  },[]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),15000);const focus=()=>void refresh();window.addEventListener("focus",focus);return()=>{clearInterval(timer);window.removeEventListener("focus",focus);};},[refresh]);
  return <>{(["gmail","outlook"] as const).map(provider=>{
    const connected=status?.mailbox.provider===provider&&status.mailbox.connected;
    const label=error?"Status unavailable":!status?"Loading…":connected?status.mailbox.paused?"Paused":"Connected":"Not connected";
    const action=administrator?connected?"Manage":"Set up":"View details for";
    return <article className="settings-card provider-card" key={provider}>
      <button className="provider-card-main" type="button" aria-label={`${action} ${names[provider]}`} onClick={()=>onSelect(provider)}>
        <span className="provider-card-icon"><Mail aria-hidden="true"/></span><ArrowUpRight className="provider-card-arrow" aria-hidden="true"/>
        <strong>{names[provider]}</strong><span className="provider-card-description">Workspace mailbox for email conversations and agent updates.</span>
        <span className={`provider-card-status${connected&&!status?.mailbox.paused?" is-connected":""}`}>{label}</span>
        <span className="plugin-card-scope">Workspace{!administrator?" · Administrator managed":""}</span><span className="plugin-card-action">{administrator?connected?"Manage":"Set up":"View details"}</span>
      </button>
    </article>;
  })}{error&&<p role="status">{error}</p>}</>;
}
