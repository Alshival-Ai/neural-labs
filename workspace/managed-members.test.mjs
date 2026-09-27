import assert from 'node:assert/strict';
import test from 'node:test';
import { revokeManagedMember } from './managed-members.mjs';

test('removed member work stops while other members and the background job are retained', async () => {
  const id = '11111111-1111-4111-8111-111111111111', calls = [], paused = [], closed = [];
  const accounts = { claude: { action: async (...args) => paused.push(args) },
    openai: { pause: async value => paused.push(value), assignRole: async (...args) => paused.push(args) } };
  const request = async (method, params) => {
    calls.push({ method, params });
    if (method === 'cron.list') return { hasMore: false, jobs: [
      { id: 'personal', agentId: 'nl-' + id.replaceAll('-', ''), enabled: true },
      { id: 'background', agentId: 'main', enabled: true }, { id: 'other', agentId: 'nl-other', enabled: true }] };
    if (method === 'sessions.list') return { hasMore: false, sessions: [{ key: 'personal-session' }] };
    return {};
  };
  const terminals = { sessions: new Map([['one', { id: 'one', ownerId: id }], ['two', { id: 'two', ownerId: 'other' }]]), destroy: session => closed.push(session.id) };
  await revokeManagedMember({ userId: id, request, accounts, terminals });
  assert.deepEqual(calls.filter(row => row.method === 'cron.update').map(row => row.params.id), ['personal']);
  assert.deepEqual(calls.filter(row => row.method === 'chat.abort').map(row => row.params.sessionKey), ['personal-session']);
  assert.deepEqual(closed, ['one']);
  assert.equal(paused.length, 3);
});
