import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";

import { api } from "./api";
import { AuthShell, Card, LoadingScreen } from "./components";
import { PendingPage } from "./pages/AccountPages";
import { LoginPage, SignupPage } from "./pages/AuthPages";
import { WorkspacePage } from "./pages/WorkspacePage";
import type { ProviderAvailability, SessionResponse } from "./types";

interface SessionContextValue {
  session: SessionResponse;
  providers: ProviderAvailability;
  refreshSession(): Promise<SessionResponse>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Session context is unavailable");
  return value;
}

function SignedOutOnly({ children }: PropsWithChildren) {
  const { session } = useSession();
  if (!session.authenticated) return children;
  if (session.user.status === "pending") return <Navigate to="/account/pending" replace />;
  if (session.user.status !== "active") return <Navigate to="/login" replace />;
  return <Navigate to="/workspace" replace />;
}

function ActiveGate() {
  const { session } = useSession();
  if (!session.authenticated) return <Navigate to="/login?error=Please+log+in" replace />;
  if (session.user.status === "pending") return <Navigate to="/account/pending" replace />;
  if (session.user.status !== "active") return <Navigate to="/login?error=Account+is+not+active" replace />;
  return <Outlet />;
}

function PendingGate() {
  const { session } = useSession();
  if (!session.authenticated) return <Navigate to="/login?error=Please+log+in" replace />;
  if (session.user.status === "pending") return <Outlet />;
  if (session.user.status !== "active") return <Navigate to="/login?error=Account+is+not+active" replace />;
  return <Navigate to="/workspace" replace />;
}

function NotFoundPage() {
  return (
    <AuthShell>
      <main className="auth-layout">
        <section className="auth-copy">
          <p className="eyebrow">404</p>
          <h1>That page isn’t here.</h1>
          <p>The requested Neural Labs control-plane page does not exist.</p>
        </section>
        <Card className="auth-card">
          <a className="button button-primary" href="/">Return to the landing page</a>
        </Card>
      </main>
    </AuthShell>
  );
}

export default function App() {
  const [session, setSession] = useState<SessionResponse>();
  const [providers, setProviders] = useState<ProviderAvailability>();
  const [loadError, setLoadError] = useState<string>();

  const refreshSession = useCallback(async () => {
    const next = await api<SessionResponse>("/api/session");
    setSession(next);
    return next;
  }, []);

  useEffect(() => {
    void Promise.all([
      refreshSession(),
      api<ProviderAvailability>("/api/auth/providers").then(setProviders),
    ]).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : "The control plane is unavailable.");
    });
  }, [refreshSession]);

  const context = useMemo(
    () => (session && providers ? { session, providers, refreshSession } : undefined),
    [providers, refreshSession, session],
  );

  if (loadError) {
    return (
      <AuthShell>
        <main className="auth-layout">
          <section className="auth-copy"><p className="eyebrow">Control plane</p><h1>Unable to connect.</h1><p>{loadError}</p></section>
          <Card className="auth-card"><button className="button button-primary" onClick={() => window.location.reload()}>Try again</button></Card>
        </main>
      </AuthShell>
    );
  }
  if (!context) return <LoadingScreen />;

  return (
    <SessionContext.Provider value={context}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<SignedOutOnly><LoginPage /></SignedOutOnly>} />
          <Route path="/signup" element={<SignedOutOnly><SignupPage /></SignedOutOnly>} />
          <Route element={<PendingGate />}>
            <Route path="/account/pending" element={<PendingPage />} />
          </Route>
          <Route element={<ActiveGate />}>
            <Route path="/workspace" element={<WorkspacePage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </SessionContext.Provider>
  );
}
