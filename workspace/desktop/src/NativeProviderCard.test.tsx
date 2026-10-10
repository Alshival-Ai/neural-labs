import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NativeProviderCard } from './NativeProviderCard';
import { nativeRequest, nativeSelection, type NativeConnection } from './nativeApi';
vi.mock('./nativeApi', () => ({ nativeRequest: vi.fn(), nativeSelection: vi.fn() }));
const connection = { id: 'fixture', provider: 'claude', scope: 'personal', generation: 3, enabled: true } as NativeConnection;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
describe('guided Anthropic card', () => {
  it('pastes a code in the card and automatically selects a verified model without launching Terminal', async () => {
    const url = 'https://claude.ai/oauth/authorize?state=fixture&code_challenge=fixture';
    const attempt = { attemptId: 'attempt', stage: 'awaiting-code', verificationUrl: url };
    let started = false, connected = false;
    const select = vi.fn().mockResolvedValue(undefined), replace = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({ opener: null, closed: false, location: { replace }, close: vi.fn() } as unknown as Window);
    vi.mocked(nativeSelection).mockReturnValue(undefined);
    vi.mocked(nativeRequest).mockImplementation(async (operation, params) => {
      if (operation === 'account.login') { started = true; return attempt; }
      if (operation === 'account.submit') { expect(params).toEqual({ attemptId: 'attempt', code: 'private-code' }); connected = true; return { ...attempt, stage: 'ready' }; }
      if (operation === 'account.status') return connected ? { ready: true, model: 'claude-model', signIn: { ...attempt, stage: 'ready' } }
        : { ready: false, pending: started, ...(started ? { signIn: attempt } : {}) };
      if (operation === 'models.list') return { models: [{ id: 'claude-model', available: true, name: 'Claude' }], defaultModel: 'claude-model' };
      throw Error(operation);
    });
    render(<NativeProviderCard provider="claude" connection={connection} ensureConnection={async () => connection} onSelect={select} />);
    await waitFor(() => expect(nativeRequest).toHaveBeenCalledWith('account.status', {}, expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: 'Connect Anthropic' }));
    const input = await screen.findByLabelText('Paste the code from Anthropic');
    expect(replace).toHaveBeenCalledWith(url);
    fireEvent.change(input, { target: { value: 'private-code' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(select).toHaveBeenCalledWith({ connection: 'fixture', model: 'claude-model' }, 3));
    expect(screen.queryByLabelText('Paste the code from Anthropic')).toBeNull();
    expect(screen.queryByText(/private Terminal/)).toBeNull();
  });
  it('shows reconnect on a revoked account and prevents shared-account mutations by members', async () => {
    vi.mocked(nativeRequest).mockResolvedValue({ ready: false, reason: 'authentication-required' });
    render(<NativeProviderCard provider="claude" connection={{ ...connection, scope: 'shared' }} ensureConnection={async () => connection}
      onSelect={vi.fn()} canManage={false} autoActivate={false} />);
    await screen.findByText('Reconnect required');
    expect(screen.getByText('An administrator needs to reconnect this account.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reconnect Anthropic' })).toBeNull();
  });
  it('offers a link when popups are blocked and resumes an attempt without starting another login', async () => {
    const attempt = { attemptId: 'attempt', stage: 'awaiting-code', verificationUrl: 'https://claude.ai/oauth/authorize?state=fixture&code_challenge=fixture' };
    vi.mocked(nativeRequest).mockResolvedValue({ ready: false, pending: true, signIn: attempt });
    render(<NativeProviderCard provider="claude" connection={connection} ensureConnection={async () => connection} onSelect={vi.fn()} />);
    expect(await screen.findByRole('link', { name: 'Open Anthropic' })).toHaveAttribute('href', attempt.verificationUrl);
    expect(vi.mocked(nativeRequest).mock.calls.every(([operation]) => operation === 'account.status')).toBe(true);
  });
});

it('refreshes models on focus without changing the saved selection', async () => {
  const openai = { ...connection, provider: 'codex' as const };
  const select = vi.fn(); let refreshed = false;
  vi.mocked(nativeSelection).mockReturnValue({ connection: 'fixture', model: 'gpt-6-astra' });
  vi.mocked(nativeRequest).mockImplementation(async operation => operation === 'account.status' ? { ready: true } : {
    models: [{ id: 'gpt-6-astra', name: 'Astra', available: true }, ...(refreshed ? [{ id: 'gpt-6.1-sol', name: 'Sol', available: true }] : [])], defaultModel: 'gpt-6-astra'
  });
  render(<NativeProviderCard provider="codex" connection={openai} ensureConnection={async () => openai} onSelect={select} />);
  await screen.findByRole('option', { name: 'Astra' });
  refreshed = true; fireEvent(window, new Event('focus'));
  await screen.findByRole('option', { name: 'Sol' });
  expect(screen.getByLabelText('OpenAI model')).toHaveValue('gpt-6-astra');
  expect(select).not.toHaveBeenCalled();
});
