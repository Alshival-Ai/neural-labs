import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publicAddress, publicTarget } from './native/browser-proxy.mjs';
import { browserFile } from './native/browser-files.mjs';
import { NativeState } from './native/state.mjs';
import { NativeArtifacts } from './native/artifacts.mjs';

test('browser egress rejects private, special, mixed DNS and alternate address encodings', async () => {
  for (const address of ['127.0.0.1','10.0.0.1','192.168.1.1','172.16.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress([93, 184, 216, 34].join('.')), true);
  const resolve = async () => [{ address: [93, 184, 216, 34].join('.'), family: 4 }, { address: '10.0.0.1', family: 4 }];
  await assert.rejects(publicTarget('https://example.com', { resolve }));
  for (const url of ['file:///etc/passwd','http://' + 'fixture-user' + ':' + 'fixture-password' + '@example.com','https://example.com:8792','http://2130706433','http://0x7f000001']) {
    await assert.rejects(publicTarget(url, { resolve: async host => [{ address: host, family: 4 }] }));
  }
  await assert.rejects(publicTarget('https://child.private.example', { deniedHosts: ['private.example'], resolve }));
  const result = await publicTarget('https://public.example/a', { resolve: async () => [{ address: [93, 184, 216, 34].join('.'), family: 4 }] });
  assert.equal(result.address, [93, 184, 216, 34].join('.')); assert.equal(result.port, 443);
});

test('browser file staging refuses symlinks and out-of-root paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-files-'));
  try {
    await mkdir(path.join(root, 'site')); await writeFile(path.join(root, 'site', 'index.html'), 'fixture');
    assert.equal((await browserFile(root, 'site/index.html')).toString(), 'fixture');
    await symlink('/etc/passwd', path.join(root, 'file-link')); await symlink('/etc', path.join(root, 'dir-link'));
    for (const relative of ['../etc/passwd','/etc/passwd','file-link','dir-link/passwd','site','site//index.html']) await assert.rejects(browserFile(root, relative));
    await assert.rejects(browserFile(root, 'site/index.html', 2));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('native artifacts remain private, reauthorize channel reads and disappear on conversation deletion', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-artifacts-')), state = new NativeState(':memory:');
  let allowed = true, calls = [];
  const artifacts = new NativeArtifacts({ root, state, authorize: async (actor, channel) => { calls.push([actor, channel]); if (!allowed) throw new Error('revoked'); } });
  state.db.prepare('INSERT INTO conversations VALUES (?,?,?,?,?)').run('conversation','alice','{}',null,0);
  try {
    const file = await artifacts.put({ conversation: 'conversation', actor: 'alice' }, { name: '../page.html', data: Buffer.from('<script>private</script>').toString('base64') });
    assert.equal(file.type, 'application/octet-stream'); assert.equal(file.name.includes('/'), false);
    await assert.rejects(artifacts.get(file.artifactId, 'bob'));
    assert.match((await artifacts.get(file.artifactId, 'alice')).data.toString(), /private/);
    const team = await artifacts.put({ conversation: 'conversation', actor: 'alice', channel: 'channel' }, { name: 'file.txt', data: Buffer.from('team').toString('base64') });
    await artifacts.get(team.artifactId, 'bob'); assert.deepEqual(calls.at(-1), ['bob','channel']);
    allowed = false; await assert.rejects(artifacts.get(team.artifactId, 'bob'));
    await artifacts.removeConversation('conversation'); allowed = true; await assert.rejects(artifacts.get(file.artifactId, 'alice'));
  } finally { artifacts.close(); state.close(); await rm(root, { recursive: true, force: true }); }
});

test('browser broker binds external approvals, rejects background writes and launches without tenant mounts', async () => {
  const { NativeBrowser } = await import('./native/browser.mjs');
  const { EventEmitter } = await import('node:events');
  const { PassThrough, Writable } = await import('node:stream');
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-broker-'));
  let args, launched = [], approved = [], allow = false, valid = true;
  const spawnProcess = (_file, parameters) => {
    args = parameters;
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      const row = JSON.parse(chunk.toString()); launched.push(row);
      child.stdout.write(JSON.stringify({ id: row.id, result: row.action === 'state' ? { url: 'https://public.example/form', epoch: 1, target: 'bound' } : { text: 'ok' } }) + '\n'); done();
    } });
    return child;
  };
  const browser = new NativeBrowser({ root, spawnProcess, createProxy: async () => ({ close() {}, disconnect() {} }) });
  const grant = { binding: { owner: 'alice' }, policy: { sandbox: 'workspace-write' }, revalidate: async () => { if (!valid) throw new Error('revoked'); } };
  const context = { actor: 'alice', conversation: 'conversation', approve: async request => { approved.push(request); return { decision: allow ? 'accept' : 'decline' }; } };
  try {
    const session = await browser.acquire(grant, context);
    assert.ok(args.includes('--unshare-net')); assert.ok(args.includes('--clearenv'));
    assert.equal(args.includes('/home/node'), false); assert.equal(args.includes('/home/node/workspace'), false);
    await assert.rejects(session.call({ action: 'type', ref: '1:1', text: 'fixture' }), /declined/);
    assert.equal(launched.some(row => row.action === 'type'), false);
    allow = true; await session.call({ action: 'type', ref: '1:1', text: 'fixture' });
    assert.equal(approved.at(-1).params.text, 'fixture'); assert.equal(launched.at(-1).expected.target, 'bound');
    valid = false; await assert.rejects(session.call({ action: 'snapshot' }), /revoked/);
    await session.release(); valid = true;
    const job = await browser.acquire({ ...grant, jobId: 'job', background: true }, context);
    await assert.rejects(job.call({ action: 'click', ref: '1:1' }), /interactive approval/); await job.release();
    const read = await browser.acquire({ ...grant, policy: { sandbox: 'read-only' } }, context);
    await assert.rejects(read.call({ action: 'click', ref: '1:1' }), /research only/); await read.release();
  } finally { await browser.close(); await rm(root, { recursive: true, force: true }); }
});
