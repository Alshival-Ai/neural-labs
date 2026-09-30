import { randomUUID } from 'node:crypto';
import { canonical } from './state.mjs';
import { providerFailure } from './provider-errors.mjs';

const ACTIVE = new Set(['starting', 'awaiting-code', 'connecting', 'loading-models', 'verifying']);
const clean = text => text.replace(/\x1b\]8;;([^\x07\x1b]*)(?:\x07|\x1b\\)/gu, '$1 ')
  .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '');
export function claudeAuthorizationUrl(output) {
  for (const match of clean(output).matchAll(/https:\/\/[^\s<>"\x1b]+(?=[\s<>"\x1b])/gu)) {
    try {
      const url = new URL(match[0]);
      if (['claude.ai', 'claude.com', 'platform.claude.com'].includes(url.hostname) && url.protocol === 'https:'
          && !url.username && !url.password && !url.port && (url.pathname === '/oauth/authorize' || url.hostname === 'claude.com' && url.pathname === '/cai/oauth/authorize')
          && url.searchParams.has('state') && url.searchParams.has('code_challenge')) return url.href;
    } catch { /* Wait for a complete, allowed URL. */ }
  }
  return null;
}

export class ClaudeSignIn {
  constructor({ spawnPty, state, environment, verify, catalog, now = Date.now }) {
    Object.assign(this, { spawnPty, state, environment, verify, catalog, now });
    this.attempts = new Map(); this.memory = new Map();
  }
  key(grant) { return `claude-health:${grant.connection}`; }
  health(grant) {
    const raw = this.state?.metadata(this.key(grant)) ?? this.memory.get(this.key(grant));
    if (raw) { const value = JSON.parse(raw); return value.binding === canonical(grant.binding) ? value : { stage: 'verification-required', error: 'native-sign-in-required' }; }
    // Project existing failed turns without exposing their content or replaying them.
    const rows = this.state?.db.prepare(`SELECT e.payload FROM events e JOIN turns t ON t.id=e.turn_id
      JOIN conversations c ON c.id=t.conversation WHERE c.binding=? AND e.type IN ('result','item-completed')
      ORDER BY e.id DESC LIMIT 100`).all(canonical(grant.binding)) || [];
    for (const row of rows) {
      const value = JSON.parse(row.payload);
      if (providerFailure(value) === 'authentication-required') { this.save(grant, { stage: 'reconnect-required', error: 'authentication-required' }); return this.health(grant); }
      if (value.type === 'result' && value.is_error === false) break;
    }
    return null;
  }
  save(grant, value) {
    const record = JSON.stringify({ ...value, binding: canonical(grant.binding), updatedAt: this.now() });
    if (this.state) this.state.setMetadata(this.key(grant), record); else this.memory.set(this.key(grant), record);
  }
  failure(grant, code) {
    if (grant.binding.provider === 'claude' && code === 'authentication-required') this.save(grant, { stage: 'reconnect-required', error: code });
  }
  view(entry) {
    return { attemptId: entry.id, stage: entry.stage, expiresAt: entry.expiresAt,
      ...(entry.url && entry.stage === 'awaiting-code' ? { verificationUrl: entry.url } : {}),
      ...(entry.error ? { error: entry.error } : {}), ...(entry.model ? { model: entry.model } : {}) };
  }
  async current(grant, attemptId) {
    await grant.revalidate();
    const entry = this.attempts.get(grant.connection);
    if (!entry || entry.actor !== grant.actor || entry.binding !== canonical(grant.binding)
        || attemptId && entry.id !== attemptId) throw new Error('This sign-in attempt is unavailable. Start a new sign-in.');
    if (entry.expiresAt <= this.now() && ACTIVE.has(entry.stage)) this.stop(entry, 'expired');
    return entry;
  }
  stop(entry, stage, error) {
    entry.stage = stage; entry.error = error; entry.url = null; entry.buffer = '';
    clearInterval(entry.timer); entry.abort?.abort();
    try { entry.process?.kill(); } catch { /* Process already exited. */ }
  }
  async status(grant) {
    const entry = this.attempts.get(grant.connection);
    if (!entry) return null;
    if (entry.actor !== grant.actor) return { stage: ACTIVE.has(entry.stage) ? 'busy' : 'idle' };
    try { return this.view(await this.current(grant)); }
    catch { this.stop(entry, 'cancelled'); throw new Error('Sign-in access changed. Start again.'); }
  }
  async login(grant, launch) {
    await grant.revalidate();
    const prior = this.attempts.get(grant.connection);
    if (prior && ACTIVE.has(prior.stage) && prior.expiresAt > this.now()) return this.view(await this.current(grant));
    if (prior) this.stop(prior, 'cancelled');
    const entry = { id: randomUUID(), actor: grant.actor, binding: canonical(grant.binding), stage: 'starting',
      expiresAt: this.now() + 10 * 60_000, buffer: '', submitted: false };
    this.attempts.set(grant.connection, entry);
    this.save(grant, { stage: 'signing-in' });
    try {
      const spec = launch.invocation('/usr/local/bin/claude', ['auth', 'login'], { env: { ...this.environment(), TERM: 'xterm-256color' } });
      await grant.revalidate();
      entry.process = this.spawnPty(spec.file, spec.args, { ...spec.options, name: 'xterm-256color', cols: 4096, rows: 30 });
      // This PTY is never registered with TerminalManager. Its transient buffer
      // is discarded before code submission; echoed codes are never retained.
      entry.process.onData(chunk => {
        if (!ACTIVE.has(entry.stage)) return;
        if (entry.submitted) {
          if (/invalid.*(?:code|grant)|expired.*code|authentication failed/i.test(clean(chunk))) this.stop(entry, 'failed', 'sign-in-failed');
          return;
        }
        entry.buffer = (entry.buffer + chunk).slice(-32768);
        const url = claudeAuthorizationUrl(entry.buffer);
        if (url) { entry.url = url; entry.stage = 'awaiting-code'; }
      });
      entry.process.onExit(({ exitCode }) => {
        if (this.attempts.get(grant.connection) !== entry || !ACTIVE.has(entry.stage) || entry.loginExited) return;
        entry.loginExited = true;
        entry.url = null; entry.buffer = ''; entry.process = null;
        if (exitCode !== 0) this.stop(entry, 'failed', 'sign-in-failed');
        else { entry.stage = 'loading-models'; void this.complete(grant, entry); }
      });
      let checking = false;
      entry.timer = setInterval(async () => {
        if (checking || !ACTIVE.has(entry.stage)) return; checking = true;
        try { await this.current(grant, entry.id); } catch { this.stop(entry, 'cancelled'); }
        finally { checking = false; }
      }, 1000); entry.timer.unref();
      return this.view(entry);
    } catch { this.stop(entry, 'failed', 'sign-in-failed'); return this.view(entry); }
  }
  async submit(grant, { attemptId, code }) {
    const entry = await this.current(grant, attemptId);
    if (typeof attemptId !== 'string' || typeof code !== 'string' || code.length > 4096
        || !code.trim() || /[\x00-\x20\x7f-\x9f]/u.test(code.trim())) throw new Error('Paste the single sign-in code from Anthropic.');
    if (entry.submitted) return this.view(entry);
    if (entry.stage !== 'awaiting-code' || !entry.process) throw new Error('Sign-in is not waiting for a code. Start again.');
    entry.submitted = true; entry.buffer = ''; entry.url = null; entry.stage = 'connecting';
    try { entry.process.write(code.trim() + '\r'); } catch { this.stop(entry, 'failed', 'sign-in-failed'); }
    return this.view(entry);
  }
  async complete(grant, entry) {
    // Verification can outlive a request; renew its authority and abort on loss.
    const monitor = setInterval(async () => {
      try { await this.current(grant, entry.id); } catch { this.stop(entry, 'cancelled'); }
    }, 1000); monitor.unref();
    try {
      await this.current(grant, entry.id);
      const catalog = await this.catalog(grant);
      entry.model = catalog.models.find(row => row.id === grant.model && row.available)?.id
        || catalog.models.find(row => row.id === catalog.defaultModel && row.available)?.id
        || catalog.models.find(row => row.available)?.id;
      if (!entry.model) throw new Error('model-unavailable');
      await this.current(grant, entry.id);
      if (!ACTIVE.has(entry.stage)) return;
      entry.stage = 'verifying'; entry.abort = new AbortController();
      const outcome = await this.verify(grant, entry.model, entry.abort.signal);
      await this.current(grant, entry.id);
      if (entry.stage !== 'verifying') return;
      if (outcome.code) {
        this.save(grant, { stage: outcome.code === 'authentication-required' ? 'reconnect-required' : 'verification-failed', error: outcome.code });
        this.stop(entry, 'failed', outcome.code);
      } else {
        this.save(grant, { stage: 'ready', verifiedAt: this.now(), model: entry.model });
        this.stop(entry, 'ready');
      }
    } catch {
      if (ACTIVE.has(entry.stage)) {
        this.save(grant, { stage: 'verification-failed', error: 'provider-unavailable' });
        this.stop(entry, 'failed', 'provider-unavailable');
      }
    } finally { clearInterval(monitor); }
  }
  async retry(grant, { attemptId }) {
    await grant.revalidate();
    if (attemptId === undefined && !this.attempts.has(grant.connection)) {
      const health = this.health(grant);
      if (health?.stage !== 'verification-failed') throw new Error('Start a new sign-in.');
      const entry = { id: randomUUID(), actor: grant.actor, binding: canonical(grant.binding), stage: 'failed',
        expiresAt: this.now() + 10 * 60_000, error: health.error, buffer: '' };
      this.attempts.set(grant.connection, entry);
    }
    const entry = await this.current(grant, attemptId);
    if (entry.stage === 'failed' && ['provider-unavailable', 'usage-limit', 'model-unavailable'].includes(entry.error)) {
      entry.expiresAt = this.now() + 10 * 60_000; entry.stage = 'loading-models'; entry.error = null;
      void this.complete(grant, entry);
    }
    return this.view(entry);
  }
  async cancel(grant, { attemptId } = {}) {
    if (typeof attemptId !== 'string') throw new Error('Select the current sign-in attempt.');
    const entry = await this.current(grant, attemptId); this.stop(entry, 'cancelled'); return { cancelled: true };
  }
  get active() { return [...this.attempts.values()].filter(entry => ACTIVE.has(entry.stage)).length; }
  close() { for (const entry of this.attempts.values()) this.stop(entry, 'cancelled'); this.attempts.clear(); }
}
