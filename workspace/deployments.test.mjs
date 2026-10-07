import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Deployments, hostingConfig, snapshotProject } from './native/deployments.mjs';
const grant = { revalidate: async () => {}, policy: { sandbox: 'workspace-write' } };
async function fixture(t, extra = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labs-deploy-'));
  const workspace = path.join(root, 'workspace'); await mkdir(path.join(workspace, 'project'), { recursive: true });
  await writeFile(path.join(workspace, 'project', 'index.html'), 'Hello, World!');
  const values = new Map(); const state = { metadata: key => values.get(key), setMetadata: (key, value) => values.set(key, value) };
  // Process tests use real Node/Python HTTP servers against isolated synthetic
  // directories. Actual namespace isolation is covered by the container smoke.
  const launcher = async ({ workspaceRoot, homeRoot }) => ({ spawn(command, args, options) {
    const translate = value => value.replaceAll('/home/node/workspace', workspaceRoot).replaceAll('/home/node', homeRoot);
    const child = spawn(command === '/usr/local/bin/node' ? process.execPath : command, args.map(translate), {
      ...options, detached: true, cwd: workspaceRoot, env: Object.fromEntries(Object.entries(options.env).map(([key,value]) => [key, translate(value)])),
    });
    child.kill = signal => { try { process.kill(-child.pid, signal); return true; } catch { return false; } };
    return child;
  } });
  // Real Node/Python processes need room to start alongside the rest of validation.
  const options = { root: path.join(root, 'state'), workspaceRoot: workspace, state, configuration: hostingConfig({}), launcher, healthTimeout: 5000, ...extra };
  const service = new Deployments(options); await service.restore();
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  return { root, workspace, service, options };
}
test('hosting defaults to loopback and validates wildcard configuration', () => {
  assert.equal(hostingConfig({}).mode, 'local'); assert.equal(hostingConfig({ NEURAL_LABS_APP_DOMAIN: '*.apps.example.com' }).domain, 'apps.example.com');
  for (const domain of ['https://*.example.com','*.example.com/path','*.foo.*.example.com','127.0.0.1','localhost','foo;bar.example']) assert.throws(() => hostingConfig({ NEURAL_LABS_APP_DOMAIN: domain }));
});
test('static app persists beyond request, update failures preserve URL and running release, stop survives restart', async t => {
  const { service, workspace, options } = await fixture(t);
  const deployed = await service.call({ action: 'deploy', project: 'project' }, grant);
  assert.equal(deployed.name, 'website1'); assert.equal(deployed.status, 'running');
  const port = service.resolve('website1'); assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'Hello, World!');
  await assert.rejects(service.call({ action: 'deploy', name: 'website1', build: 'exit 7' }, grant), /Build failed/);
  assert.equal(service.resolve('website1'), port);
  await writeFile(path.join(workspace,'project','index.html'), 'Updated');
  const updated = await service.call({ action: 'deploy', name: 'website1', build: '' }, grant);
  assert.equal(updated.url, deployed.url); assert.equal(await (await fetch(`http://127.0.0.1:${service.resolve('website1')}/`)).text(), 'Updated');
  await service.close();
  const restored = new Deployments(options); t.after(() => restored.close()); await restored.restore();
  assert.ok(restored.resolve('website1'));
  await restored.call({ action: 'stop', name: 'website1' }, grant); await restored.close();
  const stopped = new Deployments(options); t.after(() => stopped.close()); await stopped.restore();
  assert.equal(stopped.resolve('website1'), null); assert.equal((await stopped.call({ action: 'status', name: 'website1' }, grant)).status, 'stopped');
  await stopped.close();
});
test('concurrent unnamed deployments allocate distinct slots; capacity is bounded', async t => {
  const { service } = await fixture(t, { configuration: hostingConfig({ NEURAL_LABS_APP_SLOTS: '2' }) });
  const results = await Promise.all([1,2].map(() => service.call({ action: 'deploy', project: 'project' }, grant)));
  assert.deepEqual(results.map(row => row.name), ['website1','website2']); assert.notEqual(results[0].url, results[1].url);
  await assert.rejects(service.call({ action: 'deploy', project: 'project' }, grant), /slots/);
});
test('snapshot excludes credentials and refuses symlink escape', async t => {
  const { root, workspace } = await fixture(t);
  await writeFile(path.join(workspace,'project','.env'), 'secret');
  await snapshotProject(workspace, 'project', path.join(root, 'copy'));
  await assert.rejects(readFile(path.join(root,'copy','.env')), /ENOENT/);
  await symlink('/etc/passwd', path.join(workspace,'project','escape'));
  await assert.rejects(snapshotProject(workspace, 'project', path.join(root,'bad')));
  await assert.rejects(snapshotProject(workspace, '../outside', path.join(root,'bad2')));
});
test('read-only and revoked grants cannot publish; unavailable public hosting does not fall back', async t => {
  const { service } = await fixture(t);
  await assert.rejects(service.call({ action: 'deploy', project: 'project' }, { ...grant, policy: { sandbox: 'read-only' } }), /cannot modify/);
  await assert.rejects(service.call({ action: 'list' }, { revalidate: async () => { throw new Error('revoked'); } }), /revoked/);
  service.configuration = hostingConfig({ NEURAL_LABS_AUTH_MODE: 'alshival', NEURAL_LABS_APP_DOMAIN: '*.fixture.example.com' });
  service.hosting = async () => ({ domain: '*.fixture.example.com', ready: true, enabled: false });
  await assert.rejects(service.call({ action: 'deploy', project: 'project' }, grant), /Public web access/);
  service.hosting = async () => { throw new Error('offline'); };
  assert.equal((await service.call({ action: 'hosting' }, grant)).ready, false);
});
test('local gateway serves a dedicated host port and refuses unknown Host', async t => {
  const { service } = await fixture(t, { configuration: hostingConfig({ NEURAL_LABS_APP_SLOTS: '1', NEURAL_LABS_APP_LOCAL_PORT: '31980' }) });
  await service.localListeners(); const result = await service.call({ action: 'deploy', project: 'project' }, grant);
  assert.equal(await (await fetch(result.url)).text(), 'Hello, World!');
  assert.equal(await new Promise(resolve => { request(result.url, { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); }).end(); }), 404);
  await service.call({ action: 'remove', name: result.name }, grant); assert.equal((await fetch(result.url)).status, 404);
});
test('server apps receive PORT, DATA_DIR and no broker secrets; data survives updates', async t => {
  const { service, workspace } = await fixture(t);
  await writeFile(path.join(workspace,'project','server.cjs'), `const fs=require('fs'),http=require('http');fs.writeFileSync(process.env.DATA_DIR+'/value','retained');http.createServer((q,r)=>r.end(process.env.NEURAL_LABS_WORKSPACE_CONTROL_TOKEN||fs.readFileSync(process.env.DATA_DIR+'/value'))).listen(process.env.PORT,process.env.HOST);`);
  const result = await service.call({ action: 'deploy', project: 'project', kind: 'server', start: `${process.execPath} server.cjs` }, grant);
  assert.equal(result.status, 'running'); assert.equal(await (await fetch(`http://127.0.0.1:${service.resolve(result.name)}/`)).text(), 'retained');
});
test('Python HTTP app can be deployed with a production start command', async t => {
  const { service, workspace } = await fixture(t);
  await writeFile(path.join(workspace,'project','app.py'), `import os\nfrom http.server import BaseHTTPRequestHandler, HTTPServer\nclass Handler(BaseHTTPRequestHandler):\n def do_GET(self):\n  self.send_response(200); self.end_headers(); self.wfile.write(b'Python app')\nHTTPServer(('127.0.0.1',int(os.environ['PORT'])), Handler).serve_forever()\n`);
  await service.call({ action: 'deploy', project: 'project', kind: 'server', start: 'python3 app.py' }, grant);
  assert.equal(await (await fetch(`http://127.0.0.1:${service.resolve('website1')}/`)).text(), 'Python app');
});
test('bundled deploy skill is discoverable in both native providers', async t => {
  const { root, workspace } = await fixture(t);
  const { NativeSkills } = await import('./native/skills.mjs');
  const { createSkillsManager } = await import('./skills-manager.mjs');
  const skills = new NativeSkills({ root: path.join(root, 'skills'), manager: createSkillsManager({
    personalRoot: path.join(root,'personal'), teamRoot: path.join(workspace,'skills'), libraryRoots: [fileURLToPath(new URL('./bundled-skills', import.meta.url))],
  }) });
  for (const provider of ['codex','claude']) {
    const prepared = await skills.prepare({ actor: '11111111-1111-4111-8111-111111111111', provider, input: [{ type: 'text', text: 'Create Hello World and $deploy' }] });
    try { assert.ok(prepared.mounts.some(mount => mount.target === '/opt/neural-labs/skills/deploy')); }
    finally { await prepared.release(); }
  }
});
test('static server never serves dotfiles or generated symlinks', async t => {
  const { service, workspace } = await fixture(t);
  await service.call({ action: 'deploy', project: 'project', build: 'ln -s /etc/passwd public-leak; printf secret > .hidden' }, grant);
  const origin = `http://127.0.0.1:${service.resolve('website1')}`;
  for (const name of ['public-leak','.hidden','.neural-labs-static-server.mjs']) assert.equal((await fetch(`${origin}/${name}`)).status, 404);
  assert.equal(await (await fetch(origin)).text(), 'Hello, World!');
});
test('revocation during build kills the candidate and never publishes it', async t => {
  const { service } = await fixture(t);
  let allowed = true; const timer = setTimeout(() => { allowed = false; }, 150);
  t.after(() => clearTimeout(timer));
  await assert.rejects(service.call({ action: 'deploy', project: 'project', build: 'sleep 10' }, {
    ...grant, revalidate: async () => { if (!allowed) throw new Error('revoked'); },
  }), /revoked/);
  assert.equal(service.resolve('website1'), null);
});
