// Run inside the native image with generated state, no credentials or inference.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire('/usr/local/lib/neural-labs/package.json');
const { WebSocketServer } = require('ws');
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { NativeBrowser } from '/usr/local/lib/neural-labs/native/browser.mjs';
import { browserPreviews, browserFile } from '/usr/local/lib/neural-labs/native/browser-files.mjs';
const root = await mkdtemp('/tmp/browser-smoke-');
await mkdir(`${root}/workspace/site`, { recursive: true });
await writeFile(`${root}/workspace/site/index.html`, '<title>Browser fixture</title><h1>Workspace only</h1><input aria-label="Name"><button onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Click me</button><a href="data:text/plain,hello" download="hello.txt">Download</a>');
const app = createServer((_req, res) => res.end('<title>App fixture</title><h1 id="status">Waiting</h1><script>new WebSocket("ws://fixture-app.workspace.invalid/socket").onmessage=e=>document.querySelector("h1").textContent=e.data;</script>'));
const sockets = new WebSocketServer({ server: app }); sockets.on('connection', socket => socket.send('WebSocket ready'));
await new Promise(resolve => app.listen(30001, '127.0.0.1', resolve));
await mkdir(`${root}/workspace/.neural-labs`);
await writeFile(`${root}/workspace/.neural-labs/public-apps.json`, JSON.stringify({ apps: { 'fixture-app': { port: 30001 } } }));
const pdf = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 49>>stream\nBT /F1 12 Tf 20 50 Td (PDF fixture) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
let valid = true; const events = [];
const browser = new NativeBrowser({ root: `${root}/sessions`, artifacts: { put: async (_scope, file) => { assert.ok(file.data.length > 0); return { name: file.name }; }, get: async () => ({ conversation: 'fixture', type: 'application/pdf', data: pdf }) },
  preview: browserPreviews(`${root}/workspace`), readWorkspaceFile: name => browserFile(`${root}/workspace`, name) });
const grant = { binding: { owner: 'fixture', provider: 'codex' }, policy: { sandbox: 'workspace-write' }, revalidate: async () => { if (!valid) throw new Error('revoked'); } };
try {
  const session = await browser.acquire(grant, { actor: 'fixture', conversation: 'fixture', approve: async () => ({ decision: 'accept' }), emit: (...args) => events.push(args) });
  let result = await session.call({ action: 'navigate', url: 'http://files.workspace.invalid/site/index.html' });
  assert.equal(result.title, 'Browser fixture'); assert.match(result.text, /Workspace only/);
  const button = result.elements.find(item => item.text === 'Click me'); assert.ok(button);
  result = await session.call({ action: 'click', ref: button.ref }); assert.match(result.text, /Clicked/);
  await assert.rejects(session.call({ action: 'click', ref: button.ref }), /fresh snapshot|changed/);
  result = await session.call({ action: 'screenshot' }); assert.equal(result.attachment.name, 'screenshot.png'); assert.equal(events[0][0], 'artifact-created');
  result = await session.call({ action: 'snapshot' });
  await session.call({ action: 'click', ref: result.elements.find(item => item.text === 'Download').ref });
  result = await session.call({ action: 'download' }); assert.equal(result.attachment.name, 'hello.txt');
  result = await session.call({ action: 'pdf', artifact: 'pdf-fixture' }); assert.match(result.text, /PDF fixture/);
  result = await session.call({ action: 'pdf', artifact: 'pdf-fixture', page: 1 }); assert.equal(result.attachment.name, 'page-1.png');
  await session.call({ action: 'navigate', url: 'http://fixture-app.workspace.invalid/' });
  for (let attempt = 0; attempt < 10; attempt++) {
    result = await session.call({ action: 'snapshot' }); if (result.text.includes('WebSocket ready')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.match(result.text, /WebSocket ready/);
  for (const url of ['http://127.0.0.1:18790/healthz','http://169.254.169.254/','http://[::1]/']) await assert.rejects(session.call({ action: 'navigate', url }));
  if (process.argv.includes('--public')) {
    result = await session.call({ action: 'navigate', url: 'https://example.com/' }); assert.equal(result.title, 'Example Domain');
    console.log('Public HTTPS browser access passed');
  }
  valid = false; await assert.rejects(session.call({ action: 'snapshot' }), /revoked/);
  await session.release();
  console.log('Native Playwright preview, interaction, screenshots, downloads, PDF, app WebSocket, private network rejection and revocation passed');
} finally { await browser.close(); for (const client of sockets.clients) client.terminate(); sockets.close(); await new Promise(resolve => app.close(resolve)); await rm(root, { recursive: true, force: true }); }
