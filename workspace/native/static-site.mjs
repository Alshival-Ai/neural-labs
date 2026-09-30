// A static release server. No directory listings, dotfiles, or symlink escape.
import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2] || '.');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon', '.woff2':'font/woff2', '.txt':'text/plain', '.pdf':'application/pdf', '.mp4':'video/mp4' };
createServer(async (req, res) => {
  let directory, file;
  try {
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const parts = pathname.split('/').filter(Boolean);
    if (parts.some(part => part.startsWith('.') || part.includes('\\') || part.includes('\0'))) throw new Error('Invalid path');
    if (pathname.endsWith('/') || !parts.length) parts.push('index.html');
    // Anchor every root and child component instead of trusting generated links.
    directory = await open('/', constants.O_DIRECTORY | constants.O_NOFOLLOW);
    for (const part of [...root.split('/').filter(Boolean), ...parts.slice(0,-1)]) {
      const next = await open(`/proc/self/fd/${directory.fd}/${part}`, constants.O_DIRECTORY | constants.O_NOFOLLOW); await directory.close(); directory = next;
    }
    file = await open(`/proc/self/fd/${directory.fd}/${parts.at(-1)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await file.stat(); if (!info.isFile()) throw new Error('Not a file');
    res.writeHead(200, { 'Content-Type': types[path.extname(parts.at(-1))] || 'application/octet-stream', 'Content-Length': info.size, 'X-Content-Type-Options':'nosniff' });
    if (req.method === 'HEAD') res.end();
    else { const stream = file.createReadStream({ autoClose: false }); stream.pipe(res); await new Promise(resolve => { res.once('close', resolve); stream.once('end', resolve); stream.once('error', resolve); }); stream.destroy(); }
  } catch { if (!res.headersSent) res.writeHead(404).end(); else res.destroy(); }
  finally { await file?.close(); await directory?.close(); }
}).listen(Number(process.env.PORT), process.env.HOST || '127.0.0.1');
