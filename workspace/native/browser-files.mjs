import { relayWebSocket } from './browser-proxy.mjs';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { connect } from 'node:net';
import { request } from 'node:http';
import path from 'node:path';
// Open every component without following symlinks, anchored to live directory
// descriptors so a concurrent rename cannot redirect a read outside the root.
export async function browserFile(root, relative, limit = 50 * 1024 ** 2) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.includes('\0') || relative.startsWith('/')
    || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid workspace file');
  let directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const segments = relative.split('/');
    for (const part of segments.slice(0, -1)) {
      const next = await open(`/proc/self/fd/${directory.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await directory.close(); directory = next;
    }
    const file = await open(`/proc/self/fd/${directory.fd}/${segments.at(-1)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat(); if (!stat.isFile() || stat.size > limit) throw new Error('Workspace file exceeds limit or is not regular');
      const chunks = []; let length = 0;
      for await (const chunk of file.createReadStream({ autoClose: false })) { length += chunk.length; if (length > limit) throw new Error('Workspace file exceeds limit'); chunks.push(chunk); }
      return Buffer.concat(chunks);
    } finally { await file.close(); }
  } finally { await directory.close(); }
}
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
export function browserPreviews(root) {
  return async (url, incoming, response, grant, roots, head) => {
    await grant.revalidate();
    if (url.hostname.startsWith('files-')) {
      if (head !== undefined || !['GET', 'HEAD'].includes(incoming.method)) throw new Error('Static preview is read only');
      const base = roots.get(url.hostname); if (base === undefined) throw new Error('Preview unavailable');
      const relative = decodeURIComponent(url.pathname.slice(1)) || 'index.html';
      const data = await browserFile(root, base ? `${base}/${relative}` : relative);
      response.writeHead(200, { 'Content-Type': types[path.extname(relative)] || 'application/octet-stream', 'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff' });
      response.end(incoming.method === 'HEAD' ? undefined : data); return;
    }
    const slug = url.hostname.slice(0, -'.workspace.invalid'.length);
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) throw new Error('Unknown preview');
    const config = JSON.parse((await browserFile(root, '.neural-labs/public-apps.json', 65536)).toString());
    const port = config?.apps?.[slug]?.port;
    if (!Number.isInteger(port) || port < 30000 || port > 30999) throw new Error('Unknown preview app');
    if (grant.policy?.sandbox === 'read-only' && (head !== undefined || !['GET','HEAD'].includes(incoming.method))) throw new Error('Read-only preview');
    if (incoming.method === 'CONNECT') {
      const target = connect({ host: '127.0.0.1', port });
      target.on('connect', () => { response.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head?.length) target.write(head); response.pipe(target).pipe(response); });
      target.on('error', () => response.destroy()); response.on('error', () => target.destroy()); response.on('close', () => target.destroy()); return;
    }
    if (head !== undefined) { relayWebSocket(incoming, response, head, { hostname: '127.0.0.1', port, host: url.host, path: url.pathname + url.search }); return; }
    const headers = {};
    for (const key of ['accept','content-type','content-length','cookie','origin','referer','user-agent']) if (incoming.headers[key]) headers[key] = incoming.headers[key];
    headers.host = url.host;
    const upstream = request({ hostname: '127.0.0.1', port, method: incoming.method, path: url.pathname + url.search, headers, timeout: 30000 }, result => {
      const out = { ...result.headers }; delete out.connection; delete out['transfer-encoding'];
      response.writeHead(result.statusCode || 502, out); result.pipe(response);
    });
    upstream.on('error', () => response.destroy()); upstream.on('timeout', () => upstream.destroy()); response.on('close', () => upstream.destroy()); incoming.pipe(upstream);
  };
}
