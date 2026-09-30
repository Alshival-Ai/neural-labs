import { useCallback, useEffect, useState } from 'react';
import './deployments.css';
export type Deployment = { name: string; project: string; kind: string; desired: string; status: string; url: string; updatedAt: string; error: string | null; publicVerified: boolean; build?: string; start?: string; output?: string };
type Snapshot = { hosting: { mode: string; domain: string | null; ready: boolean; enabled: boolean; message?: string; error?: string; slots: number }; apps: Deployment[] };
export async function deploymentRequest<T>(input?: Record<string, unknown>): Promise<T> {
  const response = await fetch('/workspace/api/deployments', { credentials: 'same-origin',
    ...(input ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Deployment request failed');
  return body as T;
}
export function DeploymentsApp() {
  const [snapshot, setSnapshot] = useState<Snapshot>(); const [error, setError] = useState('');
  const [busy, setBusy] = useState(''); const [logs, setLogs] = useState<{ name: string; text: string }>();
  const [removing, setRemoving] = useState<string>();
  const reload = useCallback(async () => { try { setSnapshot(await deploymentRequest<Snapshot>()); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void reload(); const timer = setInterval(() => void reload(), 5000); return () => clearInterval(timer); }, [reload]);
  async function act(action: string, name: string) {
    setBusy(name); setError('');
    try { const result = await deploymentRequest<{ name: string; text: string }>({ action, name });
      if (action === 'logs') setLogs(result); else { setRemoving(undefined); await reload(); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  return <section className="deployments-app" aria-label="Deployments">
    <header><div><h2>Deployments</h2><p>Publish a website or app by asking Alshival to use <code>$deploy</code>.</p></div><button onClick={() => void reload()}>Refresh</button></header>
    {error && <p role="alert">{error}</p>}
    {!snapshot ? <p>Loading deployments…</p> : <>
      <div className="deployment-hosting"><strong>{snapshot.hosting.mode === 'public' ? `*.${snapshot.hosting.domain || 'unavailable'}` : 'Local hosting · 127.0.0.1'}</strong>
        <p>{snapshot.hosting.mode === 'public' ? 'Published apps are publicly accessible. Each app manages its own visitor sign-in.' : 'These links open on the installation’s machine. For a remote installation, use a tunnel or configure public hosting.'}</p>
        {(!snapshot.hosting.ready || !snapshot.hosting.enabled) && <p role="status">{snapshot.hosting.message || snapshot.hosting.error || 'Hosting configuration is not ready.'}</p>}
        <small>{snapshot.apps.length} of {snapshot.hosting.slots} deployment slots used</small>
      </div>
      {!snapshot.apps.length && <p>No apps deployed yet. Try: “Create a website that says Hello, World! and $deploy.”</p>}
      {snapshot.apps.map(app => <article key={app.name} className="deployment-card">
        <header><h3>{app.name}</h3><span role="status">{app.status}</span></header>
        <a href={app.url} target="_blank" rel="noopener noreferrer">{app.url}</a>
        <p>{app.project} · {app.kind} · Updated {new Date(app.updatedAt).toLocaleString()}</p>
        {app.error && <p role="status">{app.error}</p>}
        {snapshot.hosting.mode === 'public' && app.status === 'running' && !app.publicVerified && <p>Public URL verification pending.</p>}
        <div className="deployment-actions">
          <button disabled={!!busy} onClick={() => void act('logs', app.name)}>Logs</button>
          <button disabled={!!busy} onClick={() => void act(app.desired === 'stopped' ? 'start' : 'restart', app.name)}>{app.desired === 'stopped' ? 'Start' : 'Restart'}</button>
          {app.desired !== 'stopped' && <button disabled={!!busy} onClick={() => void act('stop', app.name)}>Stop</button>}
          <button disabled={!!busy} onClick={() => setRemoving(app.name)}>Remove</button>
        </div>
        {removing === app.name && <div role="alert"><p>Unpublish {app.name}? Project files and application data will be preserved.</p><button disabled={!!busy} onClick={() => void act('remove', app.name)}>Remove deployment</button> <button onClick={() => setRemoving(undefined)}>Cancel</button></div>}
        <details><summary>Build and runtime details</summary><dl><dt>Build</dt><dd>{app.build || 'No build command'}</dd><dt>Start</dt><dd>{app.start || 'Built-in static server'}</dd><dt>Public output</dt><dd>{app.output || '.'}</dd></dl></details>
      </article>)}
    </>}
    {logs && <section aria-label={`Logs for ${logs.name}`}><header><h3>{logs.name} logs</h3><button onClick={() => setLogs(undefined)}>Close logs</button></header><pre>{logs.text || 'No logs yet.'}</pre></section>}
  </section>;
}
