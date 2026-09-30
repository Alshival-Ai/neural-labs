import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserProxy } from './browser-proxy.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const interactive = new Set(['click', 'type', 'select', 'press', 'upload']);
export class NativeBrowser {
  constructor({ root, artifacts, preview, readWorkspaceFile, deniedHosts = [], maxSessions = 2, maxTabs = 4, spawnProcess = spawn, createProxy = browserProxy }) {
    if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 8 || !Number.isInteger(maxTabs) || maxTabs < 1 || maxTabs > 16) throw new Error('Invalid browser capacity');
    Object.assign(this, { root, artifacts, preview, readWorkspaceFile, deniedHosts, maxSessions, maxTabs, spawnProcess, createProxy }); this.sessions = new Map();
  }
  async acquire(grant, context) {
    const key = `${context.conversation}:${JSON.stringify(grant.binding)}`;
    let session = this.sessions.get(key);
    if (session?.busy) throw new Error('Browser is already in use');
    if (!session) {
      if (this.sessions.size >= this.maxSessions) throw new Error('Browser capacity reached; close an idle browser or retry later');
      session = { busy: true, active: true, grant, context, pending: new Map(), counter: 0, previewRoots: new Map() };
      this.sessions.set(key, session);
      try {
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        session.directory = await mkdtemp(path.join(this.root, 'session-'));
        session.proxy = await this.createProxy(path.join(session.directory, 'proxy.sock'), {
          revalidate: async () => {
            if (!session.active) throw new Error('Execution ended');
            try { await session.grant.revalidate(); }
            catch (error) { void this.destroy(key); throw error; }
          },
          deniedHosts: this.deniedHosts, preview: (url, req, res, head) => this.preview(url, req, res, session.grant, session.previewRoots, head),
        });
        const args = ['--unshare-user', '--unshare-pid', '--unshare-net', '--unshare-ipc', '--unshare-uts', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv'];
        for (const source of ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc/ssl', '/etc/fonts', '/etc/passwd', '/etc/group', '/etc/chromium', '/etc/chromium.d']) {
          try { args.push('--ro-bind', await realpath(source), source); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        args.push('--proc', '/proc', '--dev', '/dev', '--size', String(256 * 1024 ** 2), '--tmpfs', '/tmp', '--tmpfs', '/run',
          '--ro-bind', path.resolve(here, '../node_modules'), '/opt/browser/node_modules',
          '--ro-bind', path.join(here, 'browser-worker.mjs'), '/opt/browser/worker.mjs',
          '--ro-bind', session.directory, '/run/browser', '--setenv', 'HOME', '/tmp/home', '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin', '--setenv', 'NEURAL_LABS_BROWSER_MAX_TABS', String(this.maxTabs),
          '--chdir', '/tmp', '--', '/usr/local/bin/node', '/opt/browser/worker.mjs');
        session.child = this.spawnProcess('/usr/bin/bwrap', args, { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] });
        session.child.stderr.on('data', chunk => { session.error = ((session.error || '') + chunk.toString()).slice(-4000); });
        session.child.stdin.on('error', () => {});
        let lineBytes = 0;
        session.child.stdout.on('data', chunk => {
          for (const part of chunk.toString().split(/(?<=\n)/)) {
            lineBytes += Buffer.byteLength(part);
            if (lineBytes > 72 * 1024 ** 2) { void this.destroy(key); break; }
            if (part.endsWith('\n')) lineBytes = 0;
          }
        });
        createInterface({ input: session.child.stdout }).on('line', line => {
          try { const row = JSON.parse(line), pending = session.pending.get(row.id); if (!pending) return;
            session.pending.delete(row.id); clearTimeout(pending.timer); row.error ? pending.reject(new Error(row.error)) : pending.resolve(row.result);
          } catch { void this.destroy(key); }
        });
        session.child.once('error', () => void this.destroy(key)); session.child.once('exit', () => void this.destroy(key));
      } catch (error) { await this.destroy(key); throw error; }
    }
    clearTimeout(session.idle); session.active = true; session.busy = true; session.grant = grant; session.context = context;
    const lease = { active: true }; session.lease = lease;
    const live = () => lease.active && session.active && session.lease === lease;
    const abort = () => { if (session.lease === lease) void this.destroy(key); };
    context.signal?.addEventListener('abort', abort, { once: true });
    const rpc = input => new Promise((resolve, reject) => {
      const id = ++session.counter;
      const timer = setTimeout(() => { reject(new Error('Browser operation timed out')); void this.destroy(key); }, 45000);
      session.pending.set(id, { resolve, reject, timer }); session.child.stdin.write(JSON.stringify({ ...input, id }) + '\n');
    });
    return { call: async input => {
      await grant.revalidate(); if (!live()) throw new Error('Execution ended');
      if (grant.policy?.sandbox === 'read-only' && interactive.has(input.action)) throw new Error('This execution allows browser research only');
      let expected;
      if (interactive.has(input.action)) {
        expected = await rpc({ action: 'state', tab: input.tab, ref: input.ref });
        if (!new URL(expected.url).hostname.endsWith('.workspace.invalid')) {
          if (grant.background || grant.jobId) throw new Error('Browser interaction requires an interactive approval');
          const answer = await context.approve({ method: 'browser/action', params: { action: input.action, url: expected.url, element: expected.label, ref: input.ref,
            ...(input.action === 'upload' ? { path: input.path } : {}), ...(input.action === 'type' ? { text: expected.secret ? '[password field]' : input.text } : {}), ...(input.value ? { value: input.value } : {}), ...(input.key ? { key: input.key } : {}) } });
          if (!['accept', 'allow-once'].includes(answer?.decision ?? answer)) throw new Error('Browser action declined');
          await grant.revalidate(); if (!live()) throw new Error('Execution ended');
        }
      }
      const request = { ...input, expected };
      if (input.action === 'navigate') {
        const url = new URL(input.url);
        if (url.hostname === 'files.workspace.invalid') {
          const relative = decodeURIComponent(url.pathname.slice(1));
          if (!relative || relative.split('/').some(part => !part || part === '.' || part === '..') || relative.includes('\\')) throw new Error('Invalid preview path');
          const host = `files-${randomUUID()}.workspace.invalid`;
          session.previewRoots.set(host, path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative));
          request.url = `http://${host}/${encodeURIComponent(path.posix.basename(relative))}`;
        }
      }
      if (input.action === 'upload') {
        const bytes = await this.readWorkspaceFile(input.path);
        if (bytes.length > 50 * 1024 ** 2) throw new Error('Upload exceeds limit');
        request.data = bytes.toString('base64'); request.name = path.basename(input.path);
      }
      if (input.action === 'pdf') {
        const file = await this.artifacts.get(input.artifact, context.actor);
        if (file.conversation !== context.conversation || file.type !== 'application/pdf') throw new Error('Choose a PDF from this conversation');
        request.data = file.data.toString('base64');
      }
      const result = await rpc(request); await grant.revalidate(); if (!live()) throw new Error('Execution ended');
      if (result?.file) {
        const attachment = await this.artifacts.put({ conversation: context.conversation, actor: context.actor, channel: grant.team?.channel }, result.file, result.url && result.url.length <= 8192 && /^https?:\/\//.test(result.url) && !new URL(result.url).hostname.endsWith('.workspace.invalid') ? result.url : undefined);
        context.emit('artifact-created', { attachment }); return { attachment, url: result.url, ...(attachment.type?.startsWith('image/') ? { image: { data: result.file.data, mimeType: attachment.type } } : {}) };
      }
      return result;
    }, release: async () => {
      lease.active = false; context.signal?.removeEventListener('abort', abort);
      if (session.lease !== lease) return;
      session.active = false; session.busy = false; session.proxy?.disconnect?.();
      if (session.pending.size || context.signal?.aborted || grant.team || grant.jobId) await this.destroy(key);
      else session.idle = setTimeout(() => void this.destroy(key), 30 * 60_000).unref();
    } };
  }
  async destroy(key) {
    const session = this.sessions.get(key); if (!session) return; this.sessions.delete(key);
    session.active = false; clearTimeout(session.idle); session.proxy?.close(); session.child?.kill('SIGKILL');
    for (const pending of session.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(session.counter <= 1 && session.error ? `Browser startup failed: ${session.error}` : 'Browser session closed')); }
    if (session.directory) await rm(session.directory, { recursive: true, force: true });
  }
  async close() { await Promise.all([...this.sessions.keys()].map(key => this.destroy(key))); }
}
