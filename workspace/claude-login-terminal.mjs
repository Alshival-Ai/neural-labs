import { nativeLoginUrl } from "./claude-accounts.mjs";

// Adapt the existing, isolated native login PTY to the Terminal app. No second
// shell, transport, credential home, or browser input endpoint is introduced.
export async function openClaudeLoginTerminal({ accounts, terminals, owner, attemptId, actorId, resolveActor }) {
  const actor = await resolveActor?.(actorId);
  if (!actor || (owner.userId ? owner.userId !== actor.id : actor.role !== "admin")) throw new Error("Sign-in access denied");
  const agentId = await accounts.owner(owner);
  const login = accounts.loginSession(agentId, attemptId, actor.id);
  if (!login.terminalLaunch) {
    login.terminalLaunch = terminals.create(actor, {
      scope: "personal",
      title: owner.userId ? "Claude sign-in" : `Claude sign-in · ${owner.workload === "team" ? "Team Neura" : "Background AI"}`,
      providerSignIn: () => nativeLoginUrl(login.output),
      access: async viewer => {
        if (viewer.id !== actor.id) return false;
        const current = await resolveActor(actor.id).catch(() => null);
        return Boolean(current && (owner.userId || current.role === "admin"));
      },
      processFactory: () => {
        accounts.loginSession(agentId, attemptId, actor.id);
        let listener;
        return {
          process: "claude",
          onData(callback) {
            listener = event => { if (event.type === "output") callback(event.data); };
            login.listeners.add(listener);
            if (login.output) callback(login.output);
          },
          onExit(callback) {
            const finished = event => {
              if (event.type !== "finished") return;
              login.listeners.delete(listener);
              login.listeners.delete(finished);
              callback({ exitCode: login.cancelled ? 1 : login.exitCode ?? 1 });
            };
            login.listeners.add(finished);
          },
          write(data) { if (!login.exited && !login.cancelled && accounts.logins.get(agentId) === login) login.child.write(data); },
          resize(cols, rows) { if (!login.exited && !login.cancelled) login.child.resize(cols, rows); },
          kill() { void accounts.action(owner, "cancel", {}, actor.id).catch(() => {}); },
        };
      },
    }).then(session => session.id).catch(error => { login.terminalLaunch = undefined; throw error; });
  }
  return login.terminalLaunch;
}
