import { useCallback, useEffect, useState } from "react";

import { api, ApiError, mutationHeaders } from "../api";
import { useSession } from "../App";
import { AuthShell, Button, Card, LoadingScreen, Notice, StatusPill } from "../components";
import type { WorkspaceStatus } from "../types";

export function WorkspacePage() {
  const { session } = useSession();
  const [workspace, setWorkspace] = useState<WorkspaceStatus>();
  const [error, setError] = useState<string>();
  const authenticatedSession = session.authenticated ? session : undefined;

  const refresh = useCallback(async () => {
    setError(undefined);
    try {
      setWorkspace(await api<WorkspaceStatus>("/api/workspace"));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Workspace status could not be loaded.");
    }
  }, []);

  useEffect(() => {
    document.title = "Workspace · Neural Labs";
    void refresh();
  }, [refresh]);

  if (!authenticatedSession) return null;

  async function logout() {
    const result = await api<{ redirectTo: string }>("/api/auth/logout", {
      method: "POST",
      headers: mutationHeaders(authenticatedSession!.csrfToken),
      body: JSON.stringify({}),
    });
    window.location.assign(result.redirectTo);
  }

  return (
    <AuthShell>
      <main className="account-page">
        <header className="account-heading">
          <div><p className="eyebrow">Shared developer environment</p><h1>Workspace</h1><p>Build together with persistent files, skills, and native AI connections.</p></div>
          <div className="button-row"><a className="button button-secondary" href="/account">Account</a><Button variant="quiet" onClick={() => void logout()}>Log out</Button></div>
        </header>
        {error ? <Notice>{error}</Notice> : null}
        {!workspace ? <LoadingScreen label="Checking workspace" /> : (
          <div className="content-grid">
            <Card className="span-7 stack workspace-hero-card">
              <div className="card-heading"><div><p className="section-kicker">Neural Labs runtime</p><h2>Shared agent workspace</h2></div><StatusPill status={workspace.status} /></div>
              <p>Approved members share workspace files and automations. Choose your personal Codex or Claude connection in Settings.</p>
              {workspace.status === "ready" && workspace.publicUrl ? <a className="button button-primary workspace-open-button" href={workspace.publicUrl}>Launch workspace</a> : <Button variant="primary" onClick={() => void refresh()}>Check again</Button>}
            </Card>
            <Card className="span-5 stack">
              <div><p className="section-kicker">Runtime</p><h2>Environment details</h2></div>
              <dl className="detail-list">
                <div><dt>Runtime protocol</dt><dd className="code-value">{workspace.protocol}</dd></div>
                <div><dt>Codex CLI</dt><dd className="code-value">{workspace.codexVersion}</dd></div>
                <div><dt>Claude Code</dt><dd className="code-value">{workspace.claudeVersion}</dd></div>
                <div><dt>Runtime service</dt><dd>{workspace.runtimeReady ? "Ready" : "Starting"}</dd></div>
                <div><dt>Storage</dt><dd>{workspace.persistent ? "Persistent" : "Ephemeral"}</dd></div>
              </dl>
            </Card>
            <div className="span-12"><Notice tone="info">This is a collaborative environment with shared workspace files. AI credentials remain bound to the selected connection; provider processes run inside the workspace container.</Notice></div>
          </div>
        )}
      </main>
    </AuthShell>
  );
}
