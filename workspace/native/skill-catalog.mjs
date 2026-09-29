import { createHash } from "node:crypto";
import { WorkspaceSkillError, safePackagePath } from "../skills-manager.mjs";

const failure = (status, message) => new WorkspaceSkillError(status, "skill_catalog", message);
function qualified(value) {
  const match = /^@?([a-zA-Z0-9][a-zA-Z0-9-]{0,63})\/([a-z0-9][a-z0-9-]{0,63})$/.exec(value || "");
  if (!match) throw failure(400, "Choose a publisher-qualified skill package");
  return { owner: match[1].toLowerCase(), slug: match[2] };
}

// Optional public registry adapter. It consumes portable package bytes, never a
// registry CLI, plugin installer, provider credential, or executable lifecycle.
export class NativeSkillCatalog {
  constructor({ request = fetch, now = Date.now } = {}) { this.request = request; this.now = now; this.cache = new Map(); this.retryAt = 0; }
  async bytes(route, query, maximum) {
    if (this.now() < this.retryAt) throw failure(429, "The skill registry asked us to wait; retry later");
    const url = new URL(`/api/v1/${route}`, "https://clawhub.ai");
    for (const [name, value] of Object.entries(query || {})) url.searchParams.set(name, value);
    const response = await this.request(url, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { Accept: "application/json, application/octet-stream" } });
    if (response.status === 429) {
      const delay = Number(response.headers.get("retry-after"));
      this.retryAt = this.now() + (Number.isFinite(delay) && delay > 0 ? delay : 60) * 1000;
    }
    if (!response.ok) { await response.body?.cancel(); throw failure(response.status === 404 ? 404 : 502, "The selected public registry package is unavailable"); }
    const chunks = []; let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > maximum) throw failure(413, "The registry response exceeds the package limit");
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } finally { await reader.cancel(); }
  }
  async json(route, query = {}, fresh = false) {
    const key = JSON.stringify([route, query]), cached = this.cache.get(key);
    if (!fresh && cached && cached.until > this.now()) return structuredClone(cached.value);
    const value = JSON.parse((await this.bytes(route, query, 2 * 1024 ** 2)).toString("utf8"));
    if (!fresh) {
      if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, { until: this.now() + 60000, value });
    }
    return structuredClone(value);
  }
  async search(query) {
    if (typeof query !== "string" || query.length > 300) throw failure(400, "Enter a short skill search");
    if (!query.trim()) return { results: [] };
    const result = await this.json("search", { q: query.trim(), limit: "30" });
    return { results: (result.results || []).flatMap(row => {
      const owner = row.ownerHandle || row.owner?.handle;
      try {
        const selected = qualified(`${owner}/${row.slug}`), ref = `${selected.owner}/${selected.slug}`;
        return [{ ...row, slug: ref, installRef: ref, sourceUrl: `https://clawhub.ai/${selected.owner}/skills/${selected.slug}` }];
      } catch { return []; }
    }) };
  }
  async detail(reference, fresh = false) {
    const { owner, slug } = qualified(reference);
    const detail = await this.json(`skills/${slug}`, { ownerHandle: owner }, fresh);
    if (detail.owner?.handle?.toLowerCase() !== owner || detail.skill?.slug !== slug) throw failure(409, "The registry returned a different publisher or skill");
    return { ...detail, sourceUrl: `https://clawhub.ai/${owner}/skills/${slug}` };
  }
  async install(actor, { slug: reference, version }, manager) {
    if (actor.role !== "admin") throw failure(403, "Only administrators can import registry packages for the team");
    const { owner, slug } = qualified(reference);
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) throw failure(400, "Select an exact package version before importing");
    const detail = await this.detail(reference, true);
    if (detail.moderation?.isMalwareBlocked) throw failure(409, "The registry blocked this package");
    const release = await this.json(`skills/${slug}/versions/${encodeURIComponent(version)}`, { ownerHandle: owner }, true);
    const entries = release.version?.files;
    if (release.version?.version !== version || !Array.isArray(entries) || !entries.length || entries.length > 200) throw failure(409, "The registry did not provide a complete versioned package");
    const names = new Set(); let total = 0;
    for (const item of entries) {
      safePackagePath(item.path);
      if (names.has(item.path) || !/^[a-f0-9]{64}$/.test(item.sha256 || "") || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > 10 * 1024 ** 2)
        throw failure(409, "The registry package manifest is invalid");
      names.add(item.path); total += item.size;
    }
    if (total > 100 * 1024 ** 2 || !names.has("SKILL.md")) throw failure(413, "The skill package is incomplete or exceeds its size limit");
    const files = [];
    for (const item of entries) {
      const content = await this.bytes(`skills/${slug}/file`, { ownerHandle: owner, version, path: item.path }, item.size + 1);
      if (content.length !== item.size || createHash("sha256").update(content).digest("hex") !== item.sha256)
        throw failure(409, "The downloaded package does not match its version manifest");
      const binary = item.path.startsWith("assets/") || !Buffer.from(content.toString("utf8"), "utf8").equals(content) || content.includes(0);
      files.push({ path: item.path, kind: binary ? "asset" : "text", content,
        ...(typeof item.executable === "boolean" ? { executable: item.executable } : {}) });
    }
    return manager.savePackage(actor, { fields: { name: detail.skill.displayName || slug, slug, description: detail.skill.summary || "Imported skill package", scope: "team" }, files }, undefined,
      { registry: "https://clawhub.ai", owner, slug, version, files: entries.map(({ path, sha256, size }) => ({ path, sha256, size })) });
  }
}
