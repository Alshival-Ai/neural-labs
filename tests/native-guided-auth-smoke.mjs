// Disposable account only. Starts and cancels CLI authentication; never submits
// a code, accesses customer credentials, or performs inference.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { NativeAccounts } from '/usr/local/lib/neural-labs/native/accounts.mjs';
import { NativeState } from '/usr/local/lib/neural-labs/native/state.mjs';
import { createNativeLauncher, prepareNativeHome } from '/usr/local/lib/neural-labs/native/launcher.mjs';
const require = createRequire('/usr/local/lib/neural-labs/package.json');
const pty = require('node-pty');
const root = await mkdtemp('/tmp/guided-auth-fixture-');
const state = new NativeState(':memory:');
const accounts = new NativeAccounts({ spawnPty: pty.spawn, state,
  catalog: () => assert.fail('Cancelled sign-in must not load models'), verify: () => assert.fail('No inference allowed') });
try {
  await mkdir(root+'/workspace'); const home = await prepareNativeHome(root+'/home');
  const launch = await createNativeLauncher({ workspaceRoot: root+'/workspace', homeRoot: home });
  const grant = { actor: 'fixture', connection: 'fixture', binding: { owner: 'fixture', provider: 'claude', method: 'subscription', generation: 1 }, revalidate: async () => {} };
  const attempt = await accounts.login(grant, launch);
  let status;
  for (let n=0; n<45; n++) {
    status = await accounts.status(grant, launch);
    if (status.signIn?.stage === 'awaiting-code') break;
    if (status.signIn?.stage === 'failed') throw Error('Pinned Claude login failed to initialize');
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.equal(status.signIn?.stage,'awaiting-code');
  const url = new URL(status.signIn.verificationUrl);
  assert.ok(url.origin === 'https://claude.ai' && url.pathname === '/oauth/authorize'
    || url.origin === 'https://claude.com' && url.pathname === '/cai/oauth/authorize');
  assert.ok(url.searchParams.has('code_challenge') && url.searchParams.has('state'));
  assert.equal(accounts.logins.size,0,'No Terminal session or transcript');
  await accounts.cancel(grant,{attemptId:attempt.attemptId});
  assert.equal(accounts.claude.active,0);
  console.log('Pinned Claude guided authorization URL extraction and cancellation passed; no credentials or inference');
} finally { accounts.close(); state.close(); await new Promise(resolve=>setTimeout(resolve,100)); await rm(root,{recursive:true,force:true}); }
