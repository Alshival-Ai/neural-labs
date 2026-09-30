// Run inside the native image with generated fixtures and no real credentials.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { Deployments, hostingConfig } from '/usr/local/lib/neural-labs/native/deployments.mjs';
const root = await mkdtemp('/tmp/deployment-smoke-');
const workspaceRoot = `${root}/workspace`;
await mkdir(`${workspaceRoot}/hello`, { recursive: true });
await writeFile(`${workspaceRoot}/hello/index.html`, '<h1>Hello, World!</h1>');
await mkdir(`${workspaceRoot}/other-project`, { recursive: true });
await writeFile(`${workspaceRoot}/other-project/private.txt`, 'not for the deployed app');
const values = new Map();
const state = { metadata: key => values.get(key), setMetadata: (key,value) => values.set(key,value) };
const service = new Deployments({ root: `${root}/state`, workspaceRoot, state, configuration: hostingConfig({ NEURAL_LABS_APP_SLOTS:'2' }) });
const grant = { revalidate: async () => {}, policy: { sandbox:'workspace-write' } };
try {
  await service.restore(); await service.localListeners();
  const first = await service.call({ action:'deploy', project:'hello' }, grant);
  assert.equal(await (await fetch(first.url)).text(), '<h1>Hello, World!</h1>');
  await writeFile(`${workspaceRoot}/hello/server.cjs`, `const fs=require('fs'),http=require('http');
    for (const p of ['/home/node/.codex/auth.json','/home/node/.local/state/neural-labs/native','/home/node/workspace/other-project/private.txt','/var/run/docker.sock']) { if (fs.existsSync(p)) throw new Error('exposed '+p); }
    if(process.env.NEURAL_LABS_WORKSPACE_CONTROL_TOKEN)throw new Error('inherited control token');
    try{fs.writeFileSync('/home/node/workspace/unwanted','bad');throw new Error('writable release')}catch(e){if(e.message==='writable release')throw e}
    fs.writeFileSync(process.env.DATA_DIR+'/saved','persistent');
    http.createServer((q,r)=>r.end(fs.readFileSync(process.env.DATA_DIR+'/saved'))).listen(process.env.PORT,process.env.HOST);`);
  const app = await service.call({ action:'deploy', name:'server', project:'hello', kind:'server', start:'node server.cjs' }, grant);
  assert.equal(await (await fetch(app.url)).text(), 'persistent');
  await service.call({ action:'restart', name:'server' }, grant);
  assert.equal(await (await fetch(app.url)).text(), 'persistent');
  await service.call({ action:'stop', name:'server' }, grant);
  assert.equal((await fetch(app.url)).status, 404); // Registered slot, no running upstream.
  console.log('PASS: isolated static/server deployments, local routing, read-only release, dedicated app data and credential isolation');
} finally { await service.close(); await rm(root, { recursive:true, force:true }); }
