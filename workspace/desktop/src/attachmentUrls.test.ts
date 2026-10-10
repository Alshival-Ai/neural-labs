import { describe, expect, it, vi, afterEach } from 'vitest';
import { attachmentSourceUrl, attachmentCreditUrl, workspaceApiUrl } from './attachmentUrls';
import { requestJson } from './filesApi';
afterEach(() => vi.unstubAllGlobals());
describe('attachment URL boundaries', () => {
  it.each(['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=',
    'https://evil.example/workspace/api/files/content', '//evil.example/a', '/workspace/api/native/artifacts/../../admin',
    'blob:https://evil.example/id', '/api/admin/users'])('rejects active or foreign media %s', value => {
    expect(attachmentSourceUrl(value)).toBeUndefined();
  });
  it('preserves allowed signed media, inline raster previews, and same-origin blobs', () => {
    const path = '/workspace/api/native/artifacts/id?ticket=abc';
    expect(attachmentSourceUrl(window.location.origin + path)).toBe(path);
    expect(attachmentSourceUrl('data:image/png;base64,YQ==')).toBe('data:image/png;base64,YQ==');
    const blob = `blob:${window.location.origin}/fixture`;
    expect(attachmentSourceUrl(blob)).toBe(blob);
  });
  it('allows explicit external attribution but never executable links', () => {
    expect(attachmentCreditUrl('https://publisher.example/photo')).toBe('https://publisher.example/photo');
    const credentialUrl = new URL('https://publisher.example');
    credentialUrl.username = 'fixture'; credentialUrl.password = 'fixture';
    expect(attachmentCreditUrl(credentialUrl.href)).toBeUndefined();
    for (const url of ['javascript:alert(1)', 'data:text/html,test', '//evil.example']) expect(attachmentCreditUrl(url)).toBeUndefined();
  });
  it('rejects foreign and out-of-scope API targets before fetching', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const url of ['https://evil.example/workspace/api/files', '//evil.example/api', '/api/admin/users', '/workspace/api/../../admin', 'data:text/html,test']) {
      expect(() => workspaceApiUrl(url)).toThrow();
      await expect(requestJson(url)).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(Response.json({ ok: true }));
    await expect(requestJson('/workspace/api/files')).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith('/workspace/api/files', expect.objectContaining({ credentials: 'same-origin', redirect: 'error' }));
  });
});
