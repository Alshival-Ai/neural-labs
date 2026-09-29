// Display-only snapshots. Never use this cache to authorize execution.
export class ProviderDisplayCache {
  constructor({ now = Date.now } = {}) { this.revision = 0; this.now = now; this.entries = new Map(); }
  invalidate() { this.revision++; for (const entry of this.entries.values()) { entry.expires = 0; entry.failures = 0; } }
  async refreshActive() {
    await Promise.allSettled([...this.entries.values()].filter(entry =>
      entry.value?.authenticated && !entry.value?.paused && entry.failures < 3
    ).map(entry => entry.refresh()));
  }
  async get(owner, provider, check) {
    const key = JSON.stringify([owner, provider]);
    let entry = this.entries.get(key);
    if (entry?.pending) return entry.pending;
    if (entry && entry.expires > this.now()) return entry.value;
    if (!entry) {
      for (const [oldKey, old] of this.entries) if (!old.pending && !old.value?.authenticated && old.expires <= this.now()) this.entries.delete(oldKey);
      entry = { expires: 0, failures: 0 };
      this.entries.set(key, entry);
    }
    entry.refresh = () => this.get(owner, provider, check);
    const started = this.now();
    const revision = this.revision;
    entry.pending = Promise.resolve().then(check).then(value => {
      entry.value = value;
      entry.failures = 0;
      entry.expires = revision === this.revision ? this.now() + (value.authenticated && !value.paused ? 300_000 : 10_000) : 0;
      return value;
    }).catch(error => { entry.failures++; throw error; }).finally(() => {
      entry.pending = undefined;
      // Only duration and provider: no owner, credentials, messages or prompts.
      console.info(JSON.stringify({ timing: "provider-check", provider, durationMs: this.now() - started }));
    });
    return entry.pending;
  }
}
