import { describe, it, expect } from 'vitest';
import { projectFields } from '../src/projects.js';
const resource = { kind: 'server', status: 'active', provider: '', environment: '', public_url: '', external_id: null };
describe('resource sticker data', () => {
  it('reads older records and normalizes shared tags without a runtime dependency', () => {
    const old = projectFields.parse({title: 'Host', resource});
    expect(old.resource?.sticker).toBe('auto');
    expect(old.resource?.tags).toEqual([]);
    const next = projectFields.parse({title: 'Host', resource: {...resource, sticker: 'database', tags: [' Production ', 'production', 'EU']}});
    expect(next.resource?.tags).toEqual(['Production', 'EU']);
    expect(next.resource?.sticker).toBe('database');
  });
  it('rejects untrusted sticker identifiers and invalid tags', () => {
    for (const changes of [{sticker: 'https://example.test/x.svg'}, {tags: ['x'.repeat(41)]}, {tags: ['']}, {tags: Array(13).fill('x')}])
      expect(projectFields.safeParse({title:'Host', resource:{...resource,...changes}}).success).toBe(false);
  });
});
