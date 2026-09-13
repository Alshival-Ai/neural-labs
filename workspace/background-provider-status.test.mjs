import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundProviderStatus } from './background-provider-status.mjs';
const id = 'openai:neural-labs-background';
const authentication = { profiles: [{ id, provider: 'openai', type: 'oauth' }] };
function models(status = 'ok') {
  return { auth: { missingProvidersInUse: [], modelRouteIssues: [], unusableProfiles: [], oauth: {
    providers: [{ provider: 'openai', status, effectiveProfiles: [{profileId: id, type: 'oauth', status}] }],
  } } };
}
test('saved expired OAuth profiles do not report connected or model-ready', () => {
  assert.deepEqual(backgroundProviderStatus(authentication, models('expired')), {credentialSource:'chatgpt',authenticated:false,modelReady:false});
  assert.equal(backgroundProviderStatus(authentication, {auth:{missingProvidersInUse:[],modelRouteIssues:[]}}).authenticated, false);
});
test('only a usable effective profile belonging to this store establishes readiness', () => {
  for(const status of ['ok','expiring']) assert.equal(backgroundProviderStatus(authentication,models(status)).modelReady,true);
  const rejected=models();rejected.auth.unusableProfiles=[{profileId:id}];
  assert.equal(backgroundProviderStatus(authentication,rejected).authenticated,false);
  const other=models();other.auth.oauth.providers[0].effectiveProfiles[0].profileId='openai:other';
  assert.equal(backgroundProviderStatus(authentication,other).authenticated,false);
  const broken=models();broken.auth.modelRouteIssues=['unavailable'];
  assert.equal(backgroundProviderStatus(authentication,broken).modelReady,false);
  assert.equal(backgroundProviderStatus(null,null).authenticated,false);
});
