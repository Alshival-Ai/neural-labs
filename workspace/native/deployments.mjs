import { randomUUID, randomInt } from 'node:crypto';
import { constants, appendFileSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { mkdir, open, readdir, readFile, writeFile, rename, rm, readlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as portServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createNativeLauncher, prepareNativeHome, NATIVE_HOME, NATIVE_WORKSPACE } from './launcher.mjs';
import { proxyPublicApp, attachPublicAppWebSocket } from '../public-apps.mjs';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const READ = new Set(['hosting', 'list', 'status', 'logs']);
const DENIED = new Set(['.git', '.neural-labs', '.ssh', '.aws', '.codex', '.claude', 'node_modules', '__pycache__', '.venv']);
export function hostingConfig(env = {}) {
  const raw = (env.NEURAL_LABS_APP_DOMAIN || '').trim().toLowerCase().replace(/^\*\./, '');
  if (raw && (raw.length > 240 || !raw.includes('.') || raw.split('.').some(label => !LABEL.test(label))
      || /^(?:\d+\.){3}\d+$/.test(raw) || raw === 'localhost')) throw new Error('App domain must be a wildcard DNS hostname, for example *.apps.example.com');
  const slots = Number(env.NEURAL_LABS_APP_SLOTS || 10), localPort = Number(env.NEURAL_LABS_APP_LOCAL_PORT || 31000);
  if (!Number.isInteger(slots) || slots < 1 || slots > 100 || !Number.isInteger(localPort) || localPort < 1024 || localPort + slots > 65536
      || localPort < 31000 && localPort + slots > 30000) throw new Error('Invalid deployment port allocation');
  return { domain: raw || null, mode: raw ? 'public' : 'local', ready: !raw || env.NEURAL_LABS_APP_PUBLIC_READY === 'true',
    enabled: !raw || env.NEURAL_LABS_APP_PUBLIC_READY === 'true', slots, localPort,
    localEnabled: env.NEURAL_LABS_APP_LOCAL_ENABLED !== 'false', managed: env.NEURAL_LABS_AUTH_MODE === 'alshival' };
}
function relative(value, allowRoot = false) {
  if (allowRoot && (value === '.' || value === '')) return '.';
  if (typeof value !== 'string' || value.length > 1024 || value.startsWith('/') || value.includes('\\') || value.includes('\0')
      || value.split('/').some(s => !s || s === '.' || s === '..')) throw new Error('Use a workspace-relative project path');
  return value;
}
// Descriptor-relative copying refuses directory swaps, links, device files and
// accidental account/config roots. Builds run only inside this private copy.
export async function snapshotProject(root, project, destination, budget = { files: 0, bytes: 0 }) {
  relative(project);
  let source = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const segment of project.split('/')) {
      if (DENIED.has(segment) || segment.startsWith('.env')) throw new Error('Choose a project directory');
      const next = await open(`/proc/self/fd/${source.fd}/${segment}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await source.close(); source = next;
    }
    async function copy(directory, target) {
      await mkdir(target, { recursive: true, mode: 0o700 });
      for (const name of await readdir(`/proc/self/fd/${directory.fd}`)) {
        if (DENIED.has(name) || name.startsWith('.env')) continue;
        const entry = await open(`/proc/self/fd/${directory.fd}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const info = await entry.stat();
          if (++budget.files > 20000) throw new Error('Project has too many files');
          if (info.isDirectory()) await copy(entry, path.join(target, name));
          else {
            if (!info.isFile() || (budget.bytes += info.size) > 512 * 1024 ** 2) throw new Error('Project exceeds the 512 MiB deployment snapshot limit');
            const content = Buffer.alloc(info.size + 1); let size = 0;
            while (size < content.length) { const result = await entry.read(content, size, content.length - size, size); if (!result.bytesRead) break; size += result.bytesRead; }
            const after = await entry.stat();
            if (size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error('Project changed during snapshot; retry');
            await writeFile(path.join(target, name), content.subarray(0, size), { mode: info.mode & 0o111 ? 0o700 : 0o600, flag: 'wx' });
          }
        } finally { await entry.close(); }
      }
    }
    await copy(source, destination);
  } finally { await source.close(); }
}
async function available(port) {
  return new Promise(resolve => { const server = portServer(); server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => server.close(() => resolve(true))); });
}
async function ownsListener(pid, port) {
  try {
    const lines = (await readFile('/proc/net/tcp', 'utf8')).trim().split('\n').slice(1);
    const hex = port.toString(16).toUpperCase().padStart(4, '0');
    const sockets = new Set(lines.map(line => line.trim().split(/\s+/)).filter(row => row[1] === `0100007F:${hex}` && row[3] === '0A').map(row => `socket:[${row[9]}]`));
    if (!sockets.size) return false;
    const pending = [pid]; let count = 0;
    while (pending.length && ++count < 1000) {
      const current = pending.pop();
      try {
        const children = (await readFile(`/proc/${current}/task/${current}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean);
        pending.push(...children);
        for (const fd of await readdir(`/proc/${current}/fd`)) {
          try { if (sockets.has(await readlink(`/proc/${current}/fd/${fd}`))) return true; } catch {}
        }
      } catch {}
    }
  } catch {}
  return false;
}
function command(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0')) throw new Error('Invalid build or start command');
  return value;
}
export class Deployments {
  constructor({ root, workspaceRoot, state, configuration, hosting, launcher = createNativeLauncher, request = fetch,
    gated = () => false, healthTimeout = 30000, buildTimeout = 300000 }) {
    Object.assign(this, { root, workspaceRoot, state, configuration, hosting, launcher, request, gated, healthTimeout, buildTimeout });
    this.records = JSON.parse(state.metadata('deployments.v1') || '{}'); this.processes = new Map(); this.timers = new Map();
    this.tail = Promise.resolve(); this.active = 0; this.closed = false; this.servers = []; this.reserved = new Set(); this.pending = new Map();
  }
  persist() { this.state.setMetadata('deployments.v1', JSON.stringify(this.records)); }
  exclusive(work) { const job = this.tail.then(work); this.tail = job.catch(() => {}); return job; }
  async host() {
    const base = { ...this.configuration };
    if (base.managed) {
      try {
        const remote = await this.hosting();
        // Only a trusted integration can choose the public namespace.
        const parsed = hostingConfig({ NEURAL_LABS_APP_DOMAIN: remote.domain });
        if (!parsed.domain) throw new Error('Missing managed domain');
        Object.assign(base, { domain: parsed.domain, mode: 'public', ready: remote.ready === true, enabled: remote.enabled === true });
      } catch { Object.assign(base, { ready: false, enabled: false, mode: 'public', error: 'Managed hosting status is unavailable. Contact your workspace administrator.' }); }
    }
    if (base.mode === 'public' && (!base.ready || !base.enabled)) base.message = base.error || (!base.ready
      ? 'Wildcard DNS, TLS, and application ingress must be verified by the operator.'
      : 'Ask a workspace manager to enable Public web access in Workspace Settings → Services.');
    this.lastHosting = base; return base;
  }
  view(row, host) {
    const process = this.processes.get(row.name);
    return { name: row.name, project: row.project, kind: row.kind, desired: row.desired,
      status: this.pending.has(row.name) ? (this.records[row.name] ? 'updating' : 'building') : row.status === 'failed' ? 'failed' : row.desired === 'stopped' ? 'stopped' : process?.ready ? 'running' : row.status,
      updatedAt: row.updatedAt, error: row.error || null, publicVerified: row.publicVerified === true,
      url: host.mode === 'public' && host.domain ? `https://${row.name}.${host.domain}/` : `http://127.0.0.1:${host.localPort + row.slot}/`,
      previewUrl: `http://${row.name}.workspace.invalid/`, build: row.build, start: row.start, output: row.output };
  }
  async call(input, grant) {
    await grant.revalidate();
    if (!input || typeof input !== 'object' || !['hosting','list','status','logs','deploy','start','restart','stop','remove'].includes(input.action)) throw new Error('Unknown deployment operation');
    const host = await this.host();
    if (input.action === 'hosting') return host;
    if (input.action === 'list') return { hosting: host, apps: [...new Map([...Object.entries(this.records), ...this.pending]).values()].map(row => this.view(row, host)) };
    if (input.name !== undefined && (typeof input.name !== 'string' || !LABEL.test(input.name) || ['constructor','prototype','__proto__'].includes(input.name))) throw new Error('Use a lowercase DNS app name');
    if (READ.has(input.action)) {
      const row = this.records[input.name]; if (!row) throw new Error('Deployment not found');
      if (input.action === 'status') return this.view(row, host);
      try { return { name: row.name, text: (await readFile(path.join(this.root, row.name, 'app.log'), 'utf8')).slice(-64000) }; }
      catch (error) { if (error.code !== 'ENOENT') throw error; return { name: row.name, text: '' }; }
    }
    if (grant.policy?.sandbox === 'read-only') throw new Error('This execution cannot modify deployments');
    return this.exclusive(async () => {
      await grant.revalidate();
      if (this.closed || this.gated()) throw new Error('Deployments are paused for maintenance');
      this.active++;
      try {
        if (['deploy','start','restart'].includes(input.action) && host.mode === 'public' && (!host.ready || !host.enabled)) throw new Error(host.message);
        if (input.action === 'deploy') return await this.deploy(input, grant, host);
        const row = this.records[input.name]; if (!row) throw new Error('Deployment not found');
        if (['stop','remove'].includes(input.action)) {
          row.desired = 'stopped'; row.status = 'stopped'; this.persist();
          await this.routes(); await this.kill(row.name);
          if (input.action === 'remove') { delete this.records[row.name]; this.persist(); }
        } else {
          if (!row.readyOnce) throw new Error('This app has no successful release. Fix the build and deploy again.');
          await this.kill(row.name); await this.routes(); row.desired = 'running'; row.restarts = 0; row.error = null; this.persist();
          await this.launch(row); await this.routes();
        }
        return input.action === 'remove' ? { removed: row.name, dataPreserved: true } : this.view(row, host);
      } finally { this.active--; }
    });
  }
  log(name, chunk) {
    const filename = path.join(this.root, name, 'app.log');
    const text = String(chunk).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').slice(-65536);
    try { if (statSync(filename).size > 1024 * 1024) writeFileSync(filename, readFileSync(filename).subarray(-512 * 1024)); } catch {}
    appendFileSync(filename, text, { mode: 0o600 });
  }
  async deploy(input, grant, host) {
    let name = input.name;
    if (!name) { let index = 1; while (this.records[`website${index}`]) index++; name = `website${index}`; }
    if (!LABEL.test(name) || ['constructor','prototype','__proto__'].includes(name)) throw new Error('Invalid app name');
    const previous = Object.hasOwn(this.records, name) ? this.records[name] : undefined;
    const slots = new Set(Object.values(this.records).map(row => row.slot));
    let slot = previous?.slot ?? 0; if (!previous) while (slots.has(slot)) slot++;
    if (slot >= host.slots) throw new Error('All deployment slots are in use. Remove an app or ask your operator to increase capacity.');
    const kind = input.kind || previous?.kind || 'static'; if (!['static','server'].includes(kind)) throw new Error('Choose static or server');
    const project = relative(input.project || previous?.project), output = relative(input.output ?? previous?.output ?? '.', true);
    const build = command(input.build ?? previous?.build), start = command(input.start ?? previous?.start);
    if (kind === 'server' && !start) throw new Error('A server start command is required; bind to 127.0.0.1:$PORT');
    const release = randomUUID(); const appRoot = path.join(this.root, name), releaseRoot = path.join(appRoot, 'releases', release);
    await mkdir(path.dirname(releaseRoot), { recursive: true, mode: 0o700 });
    try { await snapshotProject(this.workspaceRoot, project, releaseRoot); } catch (error) { await rm(releaseRoot, { recursive: true, force: true }); throw error; }
    const row = { name, slot, project, kind, output, build, start, release, desired: 'running', status: 'building', updatedAt: new Date().toISOString() };
    this.log(name, `\nDeploy ${release}\n`);
    this.pending.set(name, row);
    let candidate, committed = false; const originalProcess = this.processes.get(name);
    try {
      if (build) await this.build(row, grant);
      await grant.revalidate(); if (this.gated()) throw new Error('Deployment paused for maintenance');
      candidate = await this.launch(row, true);
      await grant.revalidate(); if (this.gated()) throw new Error('Deployment paused for maintenance');
      if (candidate.exited || !candidate.ready) throw new Error('Application exited before activation');
      const old = this.processes.get(name);
      row.readyOnce = true; this.records[name] = row; this.processes.set(name, candidate); this.persist();
      await this.routes(); committed = true;
      if (old) await this.terminate(old);
      await this.prune(name, new Set([release, previous?.release].filter(Boolean)));
      if (host.mode === 'public') {
        try { const response = await this.request(`https://${name}.${host.domain}/`, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
          row.publicVerified = response.status >= 200 && response.status < 400; await response.body?.cancel();
        } catch { row.publicVerified = false; }
        if (!row.publicVerified) row.error = 'App is running, but its public URL could not be verified. Check DNS, TLS, and public web access.';
      }
      this.persist(); this.pending.delete(name); return this.view(row, host);
    } catch (error) {
      if (committed) { row.error = `App is running; follow-up verification failed: ${error.message}`; this.persist(); this.pending.delete(name); return this.view(row, host); }
      if (candidate) { await this.terminate(candidate); if (this.processes.get(name) === candidate) this.processes.delete(name); }
      this.log(name, `Deployment failed: ${error.message}\n`);
      if (previous) { if (originalProcess && !originalProcess.exited) this.processes.set(name, originalProcess); previous.error = `Update failed: ${error.message}`; this.records[name] = previous; await rm(releaseRoot, { recursive: true, force: true }); }
      else { row.status = 'failed'; row.error = error.message; row.desired = 'stopped'; this.records[name] = row; }
      this.persist(); await this.routes(); throw error;
    } finally { this.pending.delete(name); }
  }
  async environment(row, readOnly) {
    const home = await prepareNativeHome(path.join(this.root, row.name, 'home'));
    const folder = await open(home, constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      try { await mkdir(`/proc/self/fd/${folder.fd}/data`, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const data = await open(`/proc/self/fd/${folder.fd}/data`, constants.O_DIRECTORY | constants.O_NOFOLLOW); await data.close();
    } finally { await folder.close(); }
    const runner = await this.launcher({ workspaceRoot: path.join(this.root, row.name, 'releases', row.release), homeRoot: home, readOnly });
    return { runner, env: { HOME: NATIVE_HOME, PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', NODE_ENV: 'production',
      HOST: '127.0.0.1', DATA_DIR: `${NATIVE_HOME}/data`, PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' } };
  }
  async build(row, grant) {
    const { runner, env } = await this.environment(row, false);
    // Build tooling is app-controlled, but runs without the broker's credentials.
    const process = runner.spawn('/bin/sh', ['-c', row.build], { env: { ...env, NODE_ENV: 'development' }, stdio: ['ignore','pipe','pipe'] });
    const state = { process, port: null }; let failure;
    process.stdout?.on('data', chunk => this.log(row.name, chunk)); process.stderr?.on('data', chunk => this.log(row.name, chunk));
    const stop = error => { failure ||= error; void this.terminate(state); };
    const timer = setTimeout(() => stop(new Error('Build exceeded five minutes')), this.buildTimeout);
    const lease = setInterval(() => { void grant.revalidate().catch(stop); if (this.gated() || this.closed) stop(new Error('Maintenance started'));  }, 1000);
    try {
      const code = await new Promise((resolve, reject) => { process.once('error', reject); process.once('exit', resolve); });
      if (failure) throw failure; if (code !== 0) throw new Error('Build failed. Inspect deployment logs.');
    } finally { clearTimeout(timer); clearInterval(lease); }
  }
  async launch(row, candidate = false) {
    let port;
    const offset = randomInt(1000);
    for (let i = 0; i < 1000; i++) { const p = 30000 + (offset + i) % 1000; if (!this.reserved.has(p) && await available(p)) { port = p; break; } }
    if (!port) throw new Error('No application ports available');
    this.reserved.add(port);
    let runner, env;
    try { ({ runner, env } = await this.environment(row, true)); } catch (error) { this.reserved.delete(port); throw error; }
    let executable = '/bin/sh', args = ['-c', row.start];
    if (row.kind === 'static') {
      // Copy the reviewed server into the private release before mounting it read-only.
      const helper = '.neural-labs-static-server.mjs';
      const target = path.join(this.root, row.name, 'releases', row.release, helper);
      await rm(target, { force: true });
      await writeFile(target, await readFile(fileURLToPath(new URL('./static-site.mjs', import.meta.url))), { flag: 'wx', mode: 0o600 });
      executable = '/usr/local/bin/node'; args = [`${NATIVE_WORKSPACE}/${helper}`, row.output];
    }
    const process = runner.spawn(executable, args, { env: { ...env, PORT: String(port) }, stdio: ['ignore','pipe','pipe'] });
    const entry = { process, port, ready: false, stopping: false, exited: false, failures: 0 };
    process.stdout?.on('data', chunk => this.log(row.name, chunk)); process.stderr?.on('data', chunk => this.log(row.name, chunk));
    process.on('error', error => { entry.exited = true; this.log(row.name, `${error.message}\n`); });
    process.on('exit', () => {
      entry.exited = true; entry.ready = false; this.reserved.delete(port);
      if (this.processes.get(row.name) === entry && !entry.stopping && !this.closed) {
        row.status = 'failed'; row.error = 'Application exited. Inspect logs.'; this.persist(); void this.routes();
        const attempts = (row.restarts || 0) + 1; row.restarts = attempts;
        if (attempts <= 3 && row.desired === 'running' && !this.gated()) {
          this.timers.set(row.name, setTimeout(() => { this.timers.delete(row.name); void this.exclusive(async () => {
            if (this.closed || this.gated() || this.records[row.name] !== row || row.desired !== 'running') return;
            this.active++;
            try { await this.launch(row); await this.routes(); } catch (error) { row.error = error.message; this.persist(); } finally { this.active--; }
          }); }, 1000 * 2 ** attempts));
        }
      }
    });
    try {
      const until = Date.now() + this.healthTimeout;
      while (Date.now() < until && !entry.exited && !this.closed && !this.gated()) {
        try { const response = await this.request(`http://127.0.0.1:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(1000) });
          const healthy = response.status >= 200 && response.status < 400; await response.body?.cancel();
          if (healthy && !entry.exited && await ownsListener(process.pid, port)) { entry.ready = true; row.status = 'running'; if (!candidate) { this.processes.set(row.name, entry); this.persist(); } return entry; }
        } catch {}
        await delay(100);
      }
      throw new Error('App did not become ready. Serve HTTP on 127.0.0.1:$PORT and return success at /.');
    } catch (error) { await this.terminate(entry); this.reserved.delete(port); throw error; }
  }
  async terminate(entry) {
    entry.stopping = true;
    if (!entry.exited && entry.process.exitCode == null) {
      entry.process.kill('SIGTERM');
      await Promise.race([new Promise(resolve => entry.process.once('exit', resolve)), delay(2000)]);
      if (entry.process.exitCode == null) entry.process.kill('SIGKILL');
    }
    if (entry.port) this.reserved.delete(entry.port);
  }
  async kill(name) { clearTimeout(this.timers.get(name)); this.timers.delete(name); const entry = this.processes.get(name); this.processes.delete(name); if (entry) await this.terminate(entry); }
  async routes() {
    const apps = Object.fromEntries([...this.processes].filter(([name, p]) => p.ready && this.records[name]?.desired === 'running').map(([name, p]) => [name, { port: p.port }]));
    // The broker, not an editable project file, is authoritative for serving.
    this.routeTable = apps;
    const directory = path.join(this.workspaceRoot, '.neural-labs');
    // This compatibility manifest is only for authenticated browser previews.
    // Never follow a user-controlled .neural-labs symlink to broker state.
    let folder;
    try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') return; }
    try { folder = await open(directory, constants.O_DIRECTORY | constants.O_NOFOLLOW); } catch { return; }
    try { const temp = `public-apps-${randomUUID()}.json`; await writeFile(`/proc/self/fd/${folder.fd}/${temp}`, JSON.stringify({ apps }), { flag: 'wx', mode: 0o600 }); await rename(`/proc/self/fd/${folder.fd}/${temp}`, `/proc/self/fd/${folder.fd}/public-apps.json`); }
    catch { /* User-editable preview metadata cannot override serving state. */ }
    finally { await folder.close(); }
  }
  resolve(name) { return this.routeTable?.[name]?.port || null; }
  async prune(name, keep) {
    const root = path.join(this.root, name, 'releases');
    for (const release of await readdir(root)) if (!keep.has(release) && /^[a-f0-9-]{36}$/.test(release)) await rm(path.join(root, release), { recursive: true, force: true });
  }
  async restore() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (!this.gated()) for (const row of Object.values(this.records)) if (row.desired === 'running' && !this.processes.has(row.name)) {
      row.restarts = 0;
      try { await this.launch(row); } catch (error) { row.status = 'failed'; row.error = error.message; }
    }
    this.persist(); await this.routes();
  }
  async localListeners() {
    if (!this.configuration.localEnabled) return;
    for (let slot = 0; slot < this.configuration.slots; slot++) {
      const localPort = this.configuration.localPort + slot;
      const options = { workspaceRoot: this.workspaceRoot, publicOrigin: `http://127.0.0.1:${localPort}`, local: true,
        resolvePort: slug => this.resolve(slug), gated: this.gated };
      const rewrite = req => {
        const row = Object.values(this.records).find(record => record.slot === slot);
        if (!row || req.headers.host !== `127.0.0.1:${localPort}`) return false;
        req.url = `/__alshival_app/${row.name}${req.url}`; return true;
      };
      const server = createServer((req, res) => { if (!rewrite(req)) { res.writeHead(404).end(); return; } void proxyPublicApp(req, res, options).catch(() => res.destroy()); });
      server.on('upgrade', (req, socket) => { if (!rewrite(req)) socket.destroy(); });
      attachPublicAppWebSocket(server, options);
      try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(localPort, '0.0.0.0', resolve); }); this.servers.push(server); }
      catch (error) { await this.close(); throw new Error(`Cannot bind local app port ${localPort}: ${error.code}`); }
    }
  }
  async pause() { for (const name of this.processes.keys()) await this.kill(name); await this.routes(); }
  async close() { if (this.closed) return; this.closed = true; for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); await this.tail; await this.pause(); for (const server of this.servers) { server.closeAllConnections(); server.close(); } }
}
