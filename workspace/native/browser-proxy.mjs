import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export function publicAddress(value) {
  try {
    const address = ipaddr.process(value);
    return address.range() === 'unicast';
  } catch { return false; }
}
export async function publicTarget(raw, { resolve = lookup, deniedHosts = [] } = {}) {
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || ![80, 443].includes(Number(url.port || (url.protocol === 'https:' ? 443 : 80)))
      || deniedHosts.some(value => host === value || host.endsWith(`.${value}`))) throw new Error('Browser destination is blocked');
  const addresses = await resolve(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(row => !publicAddress(row.address))) throw new Error('Browser destination is blocked');
  return { url, address: addresses[0].address, family: addresses[0].family, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) };
}
const strip = headers => Object.fromEntries(Object.entries(headers).filter(([key]) =>
  !['proxy-authorization', 'proxy-connection', 'connection', 'upgrade', 'x-forwarded-user', 'x-api-key'].includes(key.toLowerCase())));

export function relayWebSocket(incoming, socket, head, options) {
  const headers = { ...strip(incoming.headers), connection: 'Upgrade', upgrade: 'websocket', host: options.host };
  const upstream = httpRequest({ ...options, headers, timeout: 30000 });
  upstream.on('upgrade', (response, target, targetHead) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\n');
    for (const [name, value] of Object.entries(response.headers)) {
      if (['upgrade', 'connection', 'sec-websocket-accept', 'sec-websocket-protocol', 'sec-websocket-extensions'].includes(name) && value !== undefined) socket.write(`${name}: ${value}\r\n`);
    }
    socket.write('\r\n'); if (targetHead.length) socket.write(targetHead); if (head.length) target.write(head);
    socket.pipe(target).pipe(socket); socket.on('close', () => target.destroy()); target.on('error', () => socket.destroy());
  });
  upstream.on('response', () => socket.destroy()); upstream.on('error', () => socket.destroy());
  upstream.on('timeout', () => upstream.destroy()); socket.on('error', () => upstream.destroy()); upstream.end();
}

// The only network authority mounted into a browser namespace is this Unix
// socket. DNS is resolved here and the validated address is used for the socket.
export async function browserProxy(socketPath, { revalidate, preview, deniedHosts = [], resolve } = {}) {
  const sockets = new Set();
  const server = createServer(async (incoming, response) => {
    try {
      await revalidate();
      const url = new URL(incoming.url);
      if (url.hostname.endsWith('.workspace.invalid')) {
        if (!preview || url.protocol !== 'http:' || url.port || url.username || url.password) throw new Error('Invalid preview');
        await preview(url, incoming, response); return;
      }
      if (url.protocol !== 'http:') throw new Error('Use CONNECT for HTTPS');
      const target = await publicTarget(url, { deniedHosts, resolve });
      await revalidate();
      const upstream = httpRequest({ hostname: target.address, family: target.family, port: target.port,
        method: incoming.method, path: url.pathname + url.search, headers: { ...strip(incoming.headers), host: url.host }, timeout: 30000 }, result => {
        response.writeHead(result.statusCode || 502, strip(result.headers)); result.pipe(response);
      });
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => response.destroy());
      incoming.on('aborted', () => upstream.destroy());
      response.on('close', () => upstream.destroy()); incoming.pipe(upstream);
    } catch { response.writeHead(403, { 'X-Neural-Labs-Browser-Blocked': '1' }).end('Browser destination unavailable or blocked'); }
  });
  server.maxConnections = 64; server.maxHeadersCount = 100;
  server.on('connect', async (request, socket, head) => {
    try {
      await revalidate();
      const tunnel = new URL(`https://${request.url}`);
      if (tunnel.hostname.endsWith('.workspace.invalid')) {
        if (!preview || tunnel.port !== '80' || tunnel.username || tunnel.password || tunnel.pathname !== '/' || tunnel.search || tunnel.hash) throw new Error('Invalid preview tunnel');
        tunnel.protocol = 'http:'; tunnel.port = '';
        await preview(tunnel, request, socket, head); return;
      }
      const target = await publicTarget(tunnel, { deniedHosts, resolve });
      if (target.url.pathname !== '/' || target.url.search || target.url.hash) throw new Error('Invalid tunnel');
      await revalidate();
      const upstream = connect({ host: target.address, family: target.family, port: target.port });
      sockets.add(upstream); upstream.once('close', () => sockets.delete(upstream));
      upstream.setTimeout(60000, () => upstream.destroy());
      upstream.on('connect', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); socket.pipe(upstream).pipe(socket); });
      upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy());
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });
  server.on('upgrade', async (incoming, socket, head) => {
    try {
      await revalidate();
      const url = new URL(incoming.url);
      if (url.protocol === 'ws:') url.protocol = 'http:';
      if (url.protocol !== 'http:') throw new Error('Unsupported WebSocket destination');
      if (url.hostname.endsWith('.workspace.invalid')) {
        if (!preview || url.port || url.username || url.password) throw new Error('Invalid preview');
        await preview(url, incoming, socket, head); return;
      }
      const target = await publicTarget(url, { deniedHosts, resolve }); await revalidate();
      relayWebSocket(incoming, socket, head, { hostname: target.address, family: target.family, port: target.port, host: url.host, path: url.pathname + url.search });
    } catch { socket.destroy(); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {}); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  const disconnect = () => { for (const socket of sockets) socket.destroy(); };
  const timer = setInterval(() => { void revalidate().catch(disconnect); }, 2000).unref();
  return { disconnect, close: () => { clearInterval(timer); disconnect(); server.close(); } };
}
