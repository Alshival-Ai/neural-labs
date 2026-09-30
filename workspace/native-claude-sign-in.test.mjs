import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeSignIn, claudeAuthorizationUrl } from './native/claude-sign-in.mjs';
import { NativeState } from './native/state.mjs';
const url = 'https://claude.ai/oauth/authorize?state=fixture-state&code_challenge=fixture-challenge';
function fixture(t, options = {}) {
  let now = 1000, valid = true; const processes = [], writes = []; let checks = 0;
  const state = new NativeState(':memory:');
  const grant = { connection: 'fixture', actor: 'member', binding: { owner: 'fixture', provider: 'claude', method: 'subscription', generation: 1 },
    revalidate: async () => { if (!valid) throw Error('revoked'); } };
  const flow = new ClaudeSignIn({ state, now: () => now, environment: () => ({ HOME: '/home/node' }),
    spawnPty: () => { const p = { onData(fn) { this.data = fn; }, onExit(fn) { this.exit = fn; }, write(code) { writes.push(code); }, kill() { this.killed = true; this.exit?.({ exitCode: 1 }); } }; processes.push(p); return p; },
    catalog: async () => ({ models: [{ id: 'model', available: true }], defaultModel: 'model' }),
    verify: async () => { checks++; return options.failure ? { code: options.failure } : {}; }, ...options });
  const launch = { invocation: () => ({ file: '/fixture', args: [], options: {} }) };
  t.after(() => { flow.close(); state.close(); });
  return { flow, grant, launch, processes, writes, state, checks: () => checks, advance: () => { now += 600001; }, revoke: () => { valid = false; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('guided login isolates output, accepts a code once, verifies once and survives status reload', async t => {
  const f = fixture(t); const attempt = await f.flow.login(f.grant, f.launch);
  f.processes[0].data('\x1b[32mOpen '+url.slice(0, 25)); f.processes[0].data(url.slice(25)+'\nPaste code here:');
  assert.equal((await f.flow.status(f.grant)).verificationUrl, url);
  await assert.rejects(f.flow.submit({ ...f.grant, actor: 'other' }, { attemptId: attempt.attemptId, code: 'secret-code' }));
  await assert.rejects(f.flow.submit(f.grant, { attemptId: attempt.attemptId, code: 'code\ncommand' }));
  await assert.rejects(f.flow.submit(f.grant, { code: 'secret-code' }));
  await f.flow.submit(f.grant, { attemptId: attempt.attemptId, code: 'secret-code' });
  await f.flow.submit(f.grant, { attemptId: attempt.attemptId, code: 'secret-code' });
  f.processes[0].data('secret-code');
  assert.deepEqual(f.writes, ['secret-code\r']);
  assert.equal(f.flow.attempts.get('fixture').buffer, '');
  f.processes[0].exit({ exitCode: 0 }); f.processes[0].exit({ exitCode: 0 }); await settle();
  assert.equal((await f.flow.status(f.grant)).stage, 'ready');
  assert.equal(f.flow.health(f.grant).stage, 'ready'); assert.equal(f.checks(), 1);
  await f.flow.status(f.grant); assert.equal(f.checks(), 1);
  assert.doesNotMatch(JSON.stringify(f.state.db.prepare('SELECT * FROM metadata').all()), /secret-code|oauth\/authorize/);
});
test('expiration and cancellation terminate the process; stale exit cannot remove a new attempt', async t => {
  const f = fixture(t); const old = await f.flow.login(f.grant, f.launch); f.advance();
  assert.equal((await f.flow.status(f.grant)).stage, 'expired'); assert.equal(f.processes[0].killed, true);
  const next = await f.flow.login(f.grant, f.launch); f.processes[0].exit({ exitCode: 0 });
  assert.equal((await f.flow.status(f.grant)).attemptId, next.attemptId);
  await assert.rejects(f.flow.cancel(f.grant, { attemptId: old.attemptId }));
  await f.flow.cancel(f.grant, { attemptId: next.attemptId }); assert.equal(f.flow.active, 0);
});
test('revocation and generation changes cannot submit or retain an active login', async t => {
  const f = fixture(t); const a = await f.flow.login(f.grant, f.launch);
  await assert.rejects(f.flow.submit({ ...f.grant, binding: { ...f.grant.binding, generation: 2 } }, { attemptId: a.attemptId, code: 'code' }));
  f.revoke(); await assert.rejects(f.flow.status(f.grant)); assert.equal(f.flow.active, 0);
});
test('revoked access persists and transient verification retries require an explicit operation', async t => {
  const f = fixture(t, { failure: 'usage-limit' });
  await f.flow.login(f.grant, f.launch); f.processes[0].exit({ exitCode: 0 }); await settle();
  assert.equal(f.flow.health(f.grant).error, 'usage-limit'); assert.equal(f.checks(), 1);
  const status = await f.flow.status(f.grant); await f.flow.status(f.grant); assert.equal(f.checks(), 1);
  await f.flow.retry(f.grant, { attemptId: status.attemptId }); await settle(); assert.equal(f.checks(), 2);
  f.flow.failure(f.grant, 'authentication-required'); assert.equal(f.flow.health(f.grant).stage, 'reconnect-required');
});
test('authorization URLs reject untrusted hosts, credentials, ports and non-OAuth destinations', () => {
  assert.equal(claudeAuthorizationUrl(url+'\n'), url);
  for (const bad of [url.replace('claude.ai','claude.ai.attacker.test'), url.replace('claude.ai','user@claude.ai'), url.replace('claude.ai','claude.ai:444'), url.replace('/oauth/authorize','/other')]) assert.equal(claudeAuthorizationUrl(bad), null);
});

test('Claude OSC hyperlinks preserve the authorization target and incomplete chunks wait', () => {
  assert.equal(claudeAuthorizationUrl('\x1b]8;;' + url), null);
  assert.equal(claudeAuthorizationUrl('\x1b]8;;' + url + '\x1b\\Click here\x1b]8;;\x1b\\'), url);
});

test('pinned Claude subscription authorization uses the claude.com cai route', () => {
  const target = url.replace('claude.ai/oauth', 'claude.com/cai/oauth');
  assert.equal(claudeAuthorizationUrl('\x1b]8;;'+target+'\x07Sign in\x1b]8;;\x07'), target);
});

test('changed generations cannot reuse an earlier health confirmation', t => {
  const f = fixture(t); f.flow.save(f.grant, { stage: 'ready' });
  const changed = { ...f.grant, binding: { ...f.grant.binding, generation: 2 } };
  assert.equal(f.flow.health(changed).stage, 'verification-required');
});
