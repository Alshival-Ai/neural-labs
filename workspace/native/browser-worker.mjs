// Runs entirely inside a network/filesystem namespace. No account home or
// workspace mounts; stdio RPC and a scoped Unix egress socket are its only IO.
import { createServer, connect } from 'node:net';
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
const exec = promisify(execFile);
const maxTabs = Number(process.env.NEURAL_LABS_BROWSER_MAX_TABS || 4);
const maxBytes = 50 * 1024 * 1024;
await mkdir('/tmp/home', { recursive: true });
const relay = createServer(socket => {
  const target = connect('/run/browser/proxy.sock');
  socket.pipe(target).pipe(socket); socket.on('error', () => target.destroy()); target.on('error', () => socket.destroy());
  socket.on('close', () => target.destroy()); target.on('close', () => socket.destroy());
});
await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', chromiumSandbox: true, headless: true,
  proxy: { server: `http://127.0.0.1:${relay.address().port}`, bypass: '<-loopback>' },
  args: ['--disable-quic', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(30000);
const pages = new Map(), refs = new Map(), logs = [], downloads = [];
let sequence = 0, snapshot = 0;
function register(page) {
  if (pages.size >= maxTabs) { void page.close(); return; }
  const id = String(++sequence); pages.set(id, page);
  page.on('close', () => { pages.delete(id); refs.delete(id); });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) refs.delete(id); });
  page.on('console', message => { if (message.type() === 'error') { logs.push({ tab: id, error: message.text().slice(0, 2000) }); if (logs.length > 50) logs.shift(); } });
  page.on('requestfailed', request => { logs.push({ tab: id, url: request.url().slice(0, 2000), error: request.failure()?.errorText }); if (logs.length > 50) logs.shift(); });
  page.on('dialog', dialog => void dialog.dismiss());
  page.on('download', download => {
    if (downloads.length < 8) downloads.push(download); else void download.cancel();
  });
}
context.on('page', register);
async function bytes(filename) { if ((await stat(filename)).size > maxBytes) throw new Error('File exceeds 50 MiB limit'); return (await readFile(filename)).toString('base64'); }
async function dispatch(input) {
  const { action, tab = '1' } = input;
  if (action === 'tabs') return [...pages].map(([id, page]) => ({ tab: id, url: page.url() }));
  if (action === 'new') { if (pages.size >= maxTabs) throw new Error('Browser tab limit reached'); await context.newPage(); return { tab: String(sequence) }; }
  if (!pages.size) await context.newPage();
  const page = pages.get(tab); if (!page) throw new Error('Tab unavailable');
  if (action === 'close') { await page.close(); return { closed: true }; }
  const targetState = async ref => {
    const handle = refs.get(tab)?.elements.get(ref);
    const html = handle ? await handle.evaluate(el => el.outerHTML.slice(0, 131072) + (el.form?.action || '')) : '';
    return { url: page.url(), epoch: refs.get(tab)?.epoch ?? 0, target: createHash('sha256').update(html).digest('hex'),
      label: handle ? await handle.evaluate(el => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).slice(0, 300)) : '',
      secret: handle ? await handle.getAttribute('type') === 'password' : false };
  };
  if (action === 'state') return targetState(input.ref);
  if (action === 'navigate' || action === 'search') {
    const url = action === 'search' ? `https://www.google.com/search?q=${encodeURIComponent(input.query)}` : input.url;
    if (!/^https?:\/\//.test(url)) throw new Error('Only HTTP(S) navigation is available');
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (response?.headers()['x-neural-labs-browser-blocked'] === '1') throw new Error('Browser destination blocked');
  } else if (action === 'snapshot' || action === 'find') {
    // Snapshot references are held element handles, never page-controlled IDs.
  } else if (action === 'screenshot') {
    const data = await page.screenshot({ type: 'png', fullPage: input.fullPage === true, timeout: 15000 });
    if (data.length > maxBytes) throw new Error('Screenshot exceeds limit');
    return { file: { name: 'screenshot.png', data: data.toString('base64') }, url: page.url() };
  } else if (action === 'logs') return logs;
  else if (action === 'download') {
    const download = downloads.shift(); if (!download) throw new Error('No pending download. Click a download link first.');
    const filename = await download.path(); if (!filename) throw new Error('Download failed');
    try { return { file: { name: download.suggestedFilename(), data: await bytes(filename) }, url: download.url() }; }
    finally { await download.delete(); }
  } else if (action === 'pdf') {
    const filename = '/tmp/document.pdf';
    await writeFile(filename, Buffer.from(input.data, 'base64'));
    try {
      if (input.page) {
        await exec('/usr/bin/pdftoppm', ['-f', String(input.page), '-l', String(input.page), '-scale-to', '1600', '-singlefile', '-png', filename, '/tmp/pdf-page'], { timeout: 15000, maxBuffer: 65536 });
        return { file: { name: `page-${input.page}.png`, data: await bytes('/tmp/pdf-page.png') } };
      }
      const result = await exec('/usr/bin/pdftotext', ['-f', '1', '-l', '50', filename, '-'], { timeout: 15000, maxBuffer: 1024 * 1024 });
      return { text: result.stdout.slice(0, 60000) };
    } finally { await rm(filename, { force: true }); await rm('/tmp/pdf-page.png', { force: true }); }
  } else if (action === 'scroll') await page.mouse.wheel(0, input.pixels || 600);
  else {
    const saved = refs.get(tab), handle = saved?.elements.get(input.ref);
    if (!handle || saved.url !== page.url() || input.expected && (input.expected.url !== page.url() || input.expected.epoch !== saved.epoch || input.expected.target !== (await targetState(input.ref)).target)) throw new Error('Page changed; take a fresh snapshot');
    if (action === 'click') await handle.click();
    else if (action === 'type') await handle.fill(input.text);
    else if (action === 'select') await handle.selectOption(input.value);
    else if (action === 'press') await handle.press(input.key);
    else if (action === 'upload') await handle.setInputFiles({ name: input.name, mimeType: 'application/octet-stream', buffer: Buffer.from(input.data, 'base64') });
    else throw new Error('Unknown browser operation');
    refs.delete(tab);
  }
  for (const handle of refs.get(tab)?.elements.values() || []) await handle.dispose();
  const epoch = ++snapshot, elements = new Map(), entries = [];
  const handles = await page.locator('a,button,input,textarea,select,[role="button"],[role="link"]').elementHandles();
  for (const handle of handles.slice(0, 200)) {
    if (!await handle.isVisible()) { await handle.dispose(); continue; }
    const ref = `${epoch}:${entries.length + 1}`;
    const description = await handle.evaluate(el => ({ tag: el.tagName.toLowerCase(), text: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').slice(0, 300), href: el.tagName === 'A' ? el.href : undefined, type: el.getAttribute('type') }));
    elements.set(ref, handle); entries.push({ ref, ...description });
  }
  for (const handle of handles.slice(200)) await handle.dispose();
  refs.set(tab, { epoch, url: page.url(), elements });
  let text = await page.locator('body').innerText({ timeout: 5000 });
  if (action === 'find') { const index = text.toLowerCase().indexOf(input.text.toLowerCase()); text = index < 0 ? 'Text not found' : text.slice(Math.max(0, index - 500), index + 4000); }
  return { tab, url: page.url(), title: await page.title(), text: text.slice(0, 30000), elements: entries };
}
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  let id;
  try { const input = JSON.parse(line); id = input.id; const result = await dispatch(input); process.stdout.write(JSON.stringify({ id, result }) + '\n'); }
  catch (error) { process.stdout.write(JSON.stringify({ id, error: String(error.message).slice(0, 500) }) + '\n'); }
}
await context.close(); await browser.close(); relay.close();
