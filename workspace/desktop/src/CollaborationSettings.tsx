import { useState } from 'react';
import { settingsMutationHeaders, settingsRequest } from './settingsApi';

type Credential = {id:string;name:string;scopes:string[];expires_at:string;revoked_at:string|null};
type Connection = {id:string;scope:string;label:string;enabled:boolean};
const permissions = {read:'Read session activity and results',run:'Create sessions and request execution',cancel:'Cancel its executions',approve:'Resolve operation approvals'};
export function CollaborationSettings({csrfToken}:{csrfToken:string}) {
  const [open,setOpen]=useState(false), [keys,setKeys]=useState<Credential[]>([]), [connections,setConnections]=useState<Connection[]>([]);
  const [name,setName]=useState(''), [connection,setConnection]=useState(''), [model,setModel]=useState('');
  const [scopes,setScopes]=useState<string[]>(['read','run','cancel']), [token,setToken]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const refresh=async()=>{
    try {
      const [credentials,providers,defaults]=await Promise.all([
        settingsRequest<{credentials:Credential[]}>('/api/collaboration/credentials'),
        settingsRequest<{connections:Connection[]}>('/api/runtime/connections'),
        settingsRequest<{selection:{connection:string;model:string}|null}>('/api/runtime/defaults')]);
      setKeys(credentials.credentials);setConnections(providers.connections.filter(row=>row.enabled&&['personal','shared'].includes(row.scope)));
      if(defaults.selection){setConnection(defaults.selection.connection);setModel(defaults.selection.model);}
    }catch{setError('Collaboration settings are unavailable.');}
  };
  const change=async(path:string,method:string,body?:unknown)=>{
    setBusy(true);setError('');
    try{
      const result=await settingsRequest<{token?:string}>(path,{method,headers:settingsMutationHeaders(csrfToken),...(body?{body:JSON.stringify(body)}:{})});
      if(result?.token)setToken(result.token);
      await refresh();
    }catch{setError('The request failed. Check your connection and permissions.');}finally{setBusy(false);}
  };
  return <section className="settings-card user-settings-card"><details open={open} onToggle={event=>{
    const next=event.currentTarget.open;setOpen(next);if(next&&!open)void refresh();
  }}><summary>External agent collaboration</summary>
    <p>Let another agent collaborate with Alshival through private sessions using your selected model connection. Credentials expire after 30 days and can be revoked here.</p>
    {error&&<p role="alert">{error}</p>}
    {token&&<div role="status"><label>New credential — copy it now<input readOnly value={token} aria-label="New collaboration credential" /></label>
      <button type="button" onClick={()=>void navigator.clipboard.writeText(token).catch(()=>setError('Select and copy the credential manually.'))}>Copy credential</button>
      <button type="button" onClick={()=>setToken('')}>Dismiss credential</button>
      <p>MCP endpoint: <code>{location.origin}/api/collaboration/mcp</code></p></div>}
    <form onSubmit={event=>{event.preventDefault();void change('/api/collaboration/credentials','POST',{name,connection,model,scopes,days:30});}}>
      <label>Agent name<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)} /></label>
      <label>Model connection<select required value={connection} onChange={event=>setConnection(event.target.value)}><option value="">Choose a connection</option>{connections.map(row=><option key={row.id} value={row.id}>{row.label} · {row.scope}</option>)}</select></label>
      <label>Model<input required maxLength={160} value={model} onChange={event=>setModel(event.target.value)} /></label>
      <details><summary>Permissions · {scopes.length} selected</summary>
        <label><input type="checkbox" checked={scopes.length===4} onChange={event=>setScopes(event.target.checked?Object.keys(permissions):[])} />Allow all</label>
        {Object.entries(permissions).map(([key,label])=><label key={key}><input type="checkbox" checked={scopes.includes(key)} onChange={event=>setScopes(event.target.checked?[...scopes,key]:scopes.filter(value=>value!==key))}/>{label}</label>)}
        <p>Approval permission lets this external agent approve requested commands. Leave it disabled when you want to review operations yourself.</p>
      </details>
      <button disabled={busy||!scopes.length} type="submit">Create credential</button>
    </form>
    <ul>{keys.map(key=><li key={key.id}><strong>{key.name}</strong> · {key.revoked_at?'Revoked':`Expires ${new Date(key.expires_at).toLocaleDateString()}`} · {key.scopes.join(', ')}
      {!key.revoked_at&&<button type="button" disabled={busy} onClick={()=>void change(`/api/collaboration/credentials/${key.id}`,'DELETE')}>Revoke</button>}</li>)}</ul>
  </details></section>;
}
