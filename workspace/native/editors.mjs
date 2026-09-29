import { createHash } from "node:crypto";
import { mkdir, lstat, rm } from "node:fs/promises";
import { request } from "node:http";
import path from "node:path";
import { terminalActor } from "../terminal-manager.mjs";
import { NATIVE_HOME, NATIVE_WORKSPACE } from "./launcher.mjs";

function healthy(socketPath) {
  return new Promise(resolve => {
    const req = request({ socketPath, path: "/healthz", timeout: 1000 }, response => { response.resume(); resolve(response.statusCode === 200); });
    req.on("timeout", () => req.destroy()); req.on("error", () => resolve(false)); req.end();
  });
}
export class NativeEditors {
  constructor({ interactive, root = "/run/neural-labs/editors", now = Date.now, idleMs = 10 * 60_000 }) {
    this.interactive = interactive; this.root = root; this.now = now; this.idleMs = idleMs;
    this.editors = new Map(); this.starting = new Map(); this.closed = false;
    this.timer = setInterval(() => void this.maintain(), 5000); this.timer.unref();
  }
  async ensure(request) {
    if (this.closed || this.interactive.runtime.turns.gated) throw new Error("Editor admission is closed");
    const actor = terminalActor(request.headers);
    if (!actor?.sessionHash) throw new Error("Editor membership is required");
    const id = createHash("sha256").update(actor.id).digest("hex").slice(0, 24);
    const directory = path.join(this.root, id), socketPath = path.join(directory, "editor.sock");
    if (Buffer.byteLength(socketPath) > 100) throw new Error("Editor socket path is too long");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const grant = await this.interactive.context({ actor, purpose: "editor.open", editorSocketRoot: directory });
    await grant.revalidate();
    if (!this.editors.has(id) && !this.starting.has(id)) {
      const pending = this.start(id, socketPath, grant).finally(() => this.starting.delete(id));
      this.starting.set(id, pending);
    }
    if (this.starting.has(id)) await this.starting.get(id);
    const editor = this.editors.get(id);
    if (!editor) throw new Error("Editor startup failed");
    editor.grant = grant; editor.touched = this.now();
    return { socketPath, codeServerOrigin: "http://127.0.0.1:18881", acquire: () => {
      editor.connections++; let released = false;
      return () => { if (!released) { released = true; editor.connections--; editor.touched = this.now(); } };
    } };
  }
  async start(id, socketPath, grant) {
    try {
      if (!(await lstat(socketPath)).isSocket()) throw new Error("Editor socket path is occupied by a retained file");
      await rm(socketPath);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const child = grant.launch.spawn("/usr/local/bin/code-server", ["--socket", "/run/neural-labs-editor/editor.sock",
      "--auth", "none", "--disable-telemetry", "--disable-update-check",
      "--user-data-dir", `${NATIVE_HOME}/.local/share/code-server`, "--extensions-dir", `${NATIVE_HOME}/.local/share/code-server/extensions`,
      "--app-name", "VS Code · Neural Labs", NATIVE_WORKSPACE],
    { cwd: NATIVE_WORKSPACE, env: { HOME: NATIVE_HOME, PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" }, detached: true, stdio: "ignore" });
    const editor = { child, grant, socketPath, touched: this.now(), connections: 0, failed: false, checking: false };
    child.once("error", () => { editor.failed = true; });
    child.once("exit", () => { editor.failed = true; if (this.editors.get(id) === editor) this.editors.delete(id); });
    this.editors.set(id, editor);
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (this.closed || editor.failed) throw new Error("Editor process failed to start");
        if (await healthy(socketPath)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error("Editor startup timed out");
    } catch (error) { await this.stop(id, editor); throw error; }
  }
  async stop(id, editor) {
    if (this.editors.get(id) === editor) this.editors.delete(id);
    if (editor.child.exitCode !== null || !editor.child.pid) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => { try { process.kill(-editor.child.pid, "SIGKILL"); } catch {} resolve(); }, 2000);
      editor.child.once("exit", () => { clearTimeout(timer); resolve(); });
      try { process.kill(-editor.child.pid, "SIGTERM"); } catch { clearTimeout(timer); resolve(); }
    });
  }
  async maintain() {
    await Promise.all([...this.editors].map(async ([id, editor]) => {
      if (editor.checking) return; editor.checking = true;
      try {
        await editor.grant.revalidate();
        if (!editor.connections && this.now() - editor.touched > this.idleMs) await this.stop(id, editor);
      } catch { await this.stop(id, editor); }
      finally { editor.checking = false; }
    }));
  }
  async close() { this.closed = true; clearInterval(this.timer); await Promise.allSettled(this.starting.values()); await Promise.all([...this.editors].map(([id, editor]) => this.stop(id, editor))); }
}
