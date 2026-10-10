/** Attachment locations are data, never arbitrary navigation or request targets. */
export function attachmentSourceUrl(value: string): string | undefined {
  // Inline previews must be passive media. In particular, reject HTML and SVG
  // data documents, which must instead use the authenticated file endpoint.
  if (/^data:(?:image\/(?:png|jpeg|gif|webp|avif|bmp)|audio\/(?:mpeg|mp4|ogg|wav|webm)|video\/(?:mp4|webm|ogg));base64,[a-z0-9+/=\r\n]*$/i.test(value)) return value;
  let url: URL;
  try { url = new URL(value, window.location.origin); } catch { return undefined; }
  if (url.protocol === 'blob:' && url.origin === window.location.origin) return url.href;
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== window.location.origin || url.username || url.password) return undefined;
  if (url.pathname.startsWith('/workspace/api/native/artifacts/')
    || url.pathname.startsWith('/workspace/api/neura/media/outgoing/')
    || url.pathname === '/workspace/api/files/content'
    || url.pathname === '/workspace/api/files/download') return url.pathname + url.search;
  return undefined;
}

export function attachmentCreditUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    // Source attribution intentionally links to external publishers, in a new
    // tab without opener access. It never participates in authenticated fetches.
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
  } catch { /* Invalid source metadata is not a link. */ }
  return undefined;
}

export function workspaceApiUrl(value: string): string {
  const url = new URL(value, window.location.origin);
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== window.location.origin
    || url.username || url.password || !url.pathname.startsWith('/workspace/api/')) throw new Error('Invalid workspace API URL.');
  return url.pathname + url.search;
}
