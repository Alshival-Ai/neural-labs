import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeploymentsApp } from './DeploymentsApp';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const app = { name:'website1', project:'projects/hello', kind:'static', desired:'running', status:'running', url:'http://127.0.0.1:31000/', updatedAt:'2026-09-30T12:00:00Z', error:null };
it('shows local access instructions and confirms removal without deleting project data', async () => {
  const request = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.body ? { removed:'website1', dataPreserved:true } : { hosting:{ mode:'local', ready:true, enabled:true, slots:10 }, apps:[app] })));
  vi.stubGlobal('fetch', request); render(<DeploymentsApp />);
  expect(await screen.findByRole('link', { name:app.url })).toHaveAttribute('href', app.url);
  expect(screen.getByText(/installation’s machine/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name:'Remove' }));
  expect(screen.getByText(/Project files and application data will be preserved/)).toBeTruthy();
  expect(request.mock.calls.filter(([,init]) => init?.body)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name:'Remove deployment' }));
  await waitFor(() => expect(request.mock.calls.some(([,init]) => init?.body === JSON.stringify({ action:'remove', name:'website1' }))).toBe(true));
});
it('shows disabled public hosting and renders logs as plain text', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => new Response(JSON.stringify(init?.body ? {name:'website1',text:'<script>private log</script>'} : { hosting:{mode:'public',domain:'apps.example.com',ready:true,enabled:false,slots:10,message:'Enable Public web access'},apps:[app] }))));
  render(<DeploymentsApp />);
  expect(await screen.findByText('*.apps.example.com')).toBeTruthy(); expect(screen.getByText('Enable Public web access')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name:'Logs' }));
  expect(await screen.findByText('<script>private log</script>')).toBeTruthy();
});
