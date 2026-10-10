import { expect, it } from 'vitest';
import { setupView } from '../src/views.js';
it('escapes every reflected setup field in its HTML context', () => {
  const attack = `"><img src=x onerror=alert(1)>&'`;
  const html = setupView({ publicOrigin: attack, tenantId: attack, clientId: attack, authorityHost: attack,
    error: attack, environmentMicrosoft: false, localAuthEnabled: true, microsoftAuthEnabled: false, microsoftMcpEnabled: false });
  expect(html).not.toContain(attack);
  expect(html).not.toContain('<img');
  expect(html.match(/&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;&amp;&#39;/g)).toHaveLength(5);
});
