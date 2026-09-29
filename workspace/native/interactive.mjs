import path from "node:path";
import { identity } from "./state.mjs";
import { createNativeLauncher, prepareNativeHome, NATIVE_HOME, NATIVE_WORKSPACE } from "./launcher.mjs";
import { nativeAccountEnvironment } from "./accounts.mjs";

export function interactiveAuthority({ origin, token, request = fetch }) {
  return async input => {
    const response = await request(new URL("/internal/native/interactive", origin), { method: "POST", redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Interactive workspace access is unavailable");
    return response.json();
  };
}

export class NativeInteractive {
  constructor({ runtime, authorize, resolveActor, spawnPty, launcher = createNativeLauncher }) {
    this.runtime = runtime; this.authorize = authorize; this.resolveActor = resolveActor; this.spawnPty = spawnPty; this.launcher = launcher;
  }
  async context({ actor, selection, purpose, editorSocketRoot }) {
    identity(actor.id);
    if (!/^[A-Za-z0-9_-]{43}$/.test(actor.sessionHash)) throw new Error("An authenticated workspace session is required");
    const request = { actor: actor.id, session: actor.sessionHash, purpose, ...(selection ? { selection } : {}) };
    const authorization = await this.authorize(request);
    if (authorization.actor !== actor.id) throw new Error("Interactive actor binding failed");
    if (selection) {
      if (!authorization.lease) throw new Error("Selected terminal account lease is unavailable");
      return this.runtime.execution(actor.id, authorization.lease, purpose);
    }
    // A plain Terminal/editor has its own home until an account is explicitly
    // selected. It never receives workspace services' HOME or environment.
    const homeRoot = path.join(this.runtime.root, "interactive", actor.id);
    await prepareNativeHome(homeRoot);
    const launch = await this.launcher({ workspaceRoot: this.runtime.workspaceRoot, homeRoot, editorSocketRoot });
    return { launch, actor: actor.id, home: NATIVE_HOME, cwd: NATIVE_WORKSPACE,
      revalidate: async () => {
        const current = await this.authorize(request);
        if (current.actor !== actor.id || current.role !== authorization.role) throw new Error("Interactive membership changed");
      } };
  }
  async prepareTerminal({ actor, scope, selection, cwd, shell, args, size }) {
    if (scope === "team" && selection) throw new Error("Personal AI credentials cannot be attached to a shared terminal");
    const grant = await this.context({ actor, selection, purpose: "terminal.open" });
    await grant.revalidate();
    const relative = path.relative(this.runtime.workspaceRoot, cwd);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Terminal working directory is outside the workspace");
    const env = grant.binding ? nativeAccountEnvironment(grant.binding.provider, grant.binding.method)
      : { HOME: NATIVE_HOME, PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" };
    const spec = grant.launch.invocation(shell, args, { cwd: path.join(NATIVE_WORKSPACE, relative),
      env: { ...env, USER: "node", LOGNAME: "node", SHELL: shell, TERM: "xterm-256color", HISTFILE: `${NATIVE_HOME}/.shell_history` } });
    let authorizedAt = 0;
    return {
      beforeStart: async () => { await grant.revalidate(); authorizedAt = Date.now(); },
      access: async viewer => {
        if (scope === "personal" && viewer.id !== actor.id) return false;
        try { const member = await this.resolveActor(viewer.id); await grant.revalidate(); return member?.id === viewer.id; }
        catch { return false; }
      },
      processFactory: () => {
        if (Date.now() - authorizedAt > 5000) throw new Error("Terminal launch authorization expired");
        const child = this.spawnPty(spec.file, spec.args, { ...spec.options, name: "xterm-256color", ...size });
        let pending = false;
        const timer = setInterval(() => {
          if (pending) return; pending = true;
          Promise.resolve().then(grant.revalidate).catch(() => child.kill()).finally(() => { pending = false; });
        }, 5000);
        timer.unref(); child.onExit(() => clearInterval(timer));
        return child;
      },
    };
  }
}
