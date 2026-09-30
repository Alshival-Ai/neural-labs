import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
export const ARTIFACT_PREFIX = '/workspace/api/native/artifacts/';
export function artifactType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (bytes.subarray(4, 8).toString() === 'ftyp') return 'video/mp4';
  if (bytes.subarray(0, 4).equals(Buffer.from([26,69,223,163]))) return 'video/webm';
  if (bytes.subarray(0, 3).toString() === 'ID3' || bytes[0] === 255 && (bytes[1] & 224) === 224) return 'audio/mpeg';
  if (bytes.subarray(0, 4).toString() === 'OggS') return 'audio/ogg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE') return 'audio/wav';
  return 'application/octet-stream';
}
export class NativeArtifacts {
  constructor({ root, state, authorize }) { this.root = root; this.state = state; this.authorize = authorize; this.reserved = 0; }
  async ready() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (!this.db) {
      this.db = new DatabaseSync(path.join(this.root, 'index.sqlite'));
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, conversation TEXT NOT NULL, actor TEXT NOT NULL, channel TEXT, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, source TEXT)');
    }
  }
  async put(scope, file, source) {
    await this.ready();
    const data = Buffer.from(file.data, 'base64');
    if (!data.length || data.length > 50 * 1024 ** 2) throw new Error('Artifact exceeds 50 MiB limit');
    if (scope.channel && this.db.prepare('SELECT COUNT(*) AS count FROM artifacts WHERE conversation=?').get(scope.conversation).count >= 100) throw new Error('This Team run already has 100 attachments');
    const total = this.db.prepare('SELECT COALESCE(SUM(size),0) AS size FROM artifacts').get().size;
    if (total + this.reserved + data.length > 1024 ** 3) throw new Error('Browser artifact storage is full');
    const id = randomUUID(), name = String(file.name || 'download').replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 180);
    const type = artifactType(data);
    this.reserved += data.length;
    try {
      await writeFile(path.join(this.root, id), data, { flag: 'wx', mode: 0o600 });
      this.db.prepare('INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?)').run(id, scope.conversation, scope.actor, scope.channel || null, name, type, data.length, source || null); }
    catch (error) { await rm(path.join(this.root, id), { force: true }); throw error; }
    finally { this.reserved -= data.length; }
    return { artifactId: id, name, type, size: data.length, url: ARTIFACT_PREFIX + id, ...(source ? { sourceUrl: source } : {}) };
  }
  async get(id, actor) {
    await this.ready();
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Artifact unavailable');
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id=?').get(id);
    if (!row) throw new Error('Artifact unavailable');
    const conversation = this.state.db.prepare('SELECT c.actor,p.deleted FROM conversations c LEFT JOIN conversation_profiles p ON p.conversation=c.id WHERE c.id=?').get(row.conversation);
    if (!conversation || conversation.deleted || (!row.channel && row.actor !== actor)) throw new Error('Artifact unavailable');
    if (await this.authorize(actor, row.channel) === false) throw new Error('Artifact access revoked');
    return { ...row, data: await readFile(path.join(this.root, id)) };
  }
  async removeConversation(conversation) {
    await this.ready();
    for (const row of this.db.prepare('SELECT id FROM artifacts WHERE conversation=?').all(conversation)) await rm(path.join(this.root, row.id), { force: true });
    this.db.prepare('DELETE FROM artifacts WHERE conversation=?').run(conversation);
  }
  async reconcile() {
    await this.ready();
    for (const row of this.db.prepare('SELECT DISTINCT conversation FROM artifacts').all()) {
      const conversation = this.state.db.prepare('SELECT c.id,p.deleted FROM conversations c LEFT JOIN conversation_profiles p ON p.conversation=c.id WHERE c.id=?').get(row.conversation);
      if (!conversation || conversation.deleted) await this.removeConversation(row.conversation);
    }
    for (const filename of await readdir(this.root)) {
      if (/^[a-f0-9-]{36}$/.test(filename) && !this.db.prepare('SELECT id FROM artifacts WHERE id=?').get(filename)) await rm(path.join(this.root, filename), { force: true });
    }
  }
  close() { this.db?.close(); }
}
