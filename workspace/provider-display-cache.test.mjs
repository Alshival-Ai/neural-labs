import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderDisplayCache } from './provider-display-cache.mjs';
test('display checks coalesce by owner and provider, expire, and invalidate pending results', async () => {
  let now = 0, calls = 0, finish;
  const cache = new ProviderDisplayCache({ now: () => now });
  const check = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const a = cache.get('alice', 'anthropic', check);
  const b = cache.get('alice', 'anthropic', check);
  await Promise.resolve(); assert.equal(calls, 1);
  cache.invalidate(); finish({ authenticated: true, paused: false });
  await Promise.all([a,b]);
  await cache.get('alice', 'anthropic', async () => { calls++; return { authenticated: true }; });
  assert.equal(calls, 2);
  await cache.get('alice', 'anthropic', check); assert.equal(calls, 2);
  await cache.get('bob', 'anthropic', async () => { calls++; return {}; });
  await cache.get('alice', 'openai', async () => { calls++; return {}; });
  assert.equal(calls, 4);
  now = 300_001;
  await cache.get('alice', 'anthropic', async () => { calls++; return {}; });
  assert.equal(calls, 5);
});
test('failed checks are retriable and never cached as disconnected', async () => {
  const cache = new ProviderDisplayCache();
  await assert.rejects(cache.get('alice','openai',async () => { throw new Error('timeout'); }));
  assert.deepEqual(await cache.get('alice','openai',async () => ({authenticated:true})), {authenticated:true});
});
test('background refresh is owner/provider scoped, skips paused accounts and stops after three errors', async () => {
  let now = 0, calls = 0, fail = false;
  const cache = new ProviderDisplayCache({now:()=>now});
  await cache.get('alice','anthropic',async()=> {calls++; if(fail)throw Error('timeout'); return {authenticated:true};});
  await cache.get('team','openai',async()=>({authenticated:true,paused:true}));
  fail = true;
  for(let i=0;i<5;i++){now+=300_001;await cache.refreshActive();}
  assert.equal(calls,4);
  cache.invalidate();fail=false;
  await cache.refreshActive();assert.equal(calls,5);
});
