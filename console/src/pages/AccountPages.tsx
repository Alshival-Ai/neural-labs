import { useEffect, useState } from "react";

import { api, mutationHeaders } from "../api";
import { useSession } from "../App";
import { AuthShell, Button, Card, Notice, StatusPill } from "../components";

async function logout(csrfToken: string) {
  const result = await api<{ redirectTo: string }>("/api/auth/logout", {
    method: "POST",
    headers: mutationHeaders(csrfToken),
    body: JSON.stringify({}),
  });
  window.location.assign(result.redirectTo);
}

export function PendingPage() {
  const { session, refreshSession } = useSession();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    document.title = "Approval pending · Neural Labs";
  }, []);

  if (!session.authenticated) return null;

  async function refresh() {
    setRefreshing(true);
    const updated = await refreshSession();
    if (updated.authenticated && updated.user.status === "active") {
      window.location.assign("/workspace");
      return;
    }
    setRefreshing(false);
  }

  return (
    <AuthShell>
      <main className="auth-layout">
        <section className="auth-copy">
          <p className="eyebrow">Access requested</p>
          <h1>You’re in the queue.</h1>
          <p>An administrator needs to approve this account before Neural Labs workspace access becomes available.</p>
        </section>
        <Card className="auth-card stack">
          <div className="identity-heading">
            <div className="avatar" aria-hidden="true">{session.user.displayName.slice(0, 1).toUpperCase()}</div>
            <div><h2>{session.user.displayName}</h2><p>{session.user.email}</p></div>
          </div>
          <div className="status-row"><span>Account status</span><StatusPill status="pending" /></div>
          <Notice tone="info">You can safely close this page. Sign in again after your administrator approves the request.</Notice>
          <div className="button-row">
            <Button variant="primary" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Checking…" : "Check status"}</Button>
            <Button onClick={() => void logout(session.csrfToken)}>Log out</Button>
          </div>
        </Card>
      </main>
    </AuthShell>
  );
}
