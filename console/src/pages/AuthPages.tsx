import { type FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api, ApiError } from "../api";
import { AuthShell, Button, Card, Field, Notice } from "../components";
import { useSession } from "../App";
import type { PublicUser } from "../types";

interface AuthResponse {
  user: PublicUser;
  redirectTo: string;
}

function useQueryNotices() {
  const [search] = useSearchParams();
  return { error: search.get("error"), success: search.get("success") };
}

function completeAuthentication(redirectTo: string) {
  window.location.assign(redirectTo);
}

export function LoginPage() {
  const { providers } = useSession();
  const query = useQueryNotices();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Log in · Neural Labs";
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<AuthResponse>("/api/auth/local/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      completeAuthentication(result.redirectTo);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Login could not be completed.");
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <main className="auth-layout">
        <section className="auth-copy">
          <p className="eyebrow">Private AI workspace</p>
          <h1>Welcome back.</h1>
          <p>Sign in with a provider enabled by your Neural Labs administrator.</p>
        </section>
        <Card className="auth-card stack">
          <div>
            <p className="section-kicker">Secure access</p>
            <h2>Log in</h2>
            <p>Continue to this Neural Labs deployment.</p>
          </div>
          {error || query.error ? <Notice>{error ?? query.error}</Notice> : null}
          {query.success ? <Notice tone="success">{query.success}</Notice> : null}
          {providers.local.enabled ? (
            <form className="stack" onSubmit={submit}>
              <Field label="Email"><input name="email" type="email" autoComplete="username" required /></Field>
              <Field label="Password"><input name="password" type="password" autoComplete="current-password" required /></Field>
              <Button variant="primary" type="submit" disabled={submitting}>{submitting ? "Logging in…" : "Log in"}</Button>
              <p className="form-footnote">Need an account? <Link to="/signup">Request access</Link>.</p>
            </form>
          ) : null}
          {providers.microsoft.enabled ? (
            <>
              {providers.local.enabled ? <div className="divider"><span>or</span></div> : null}
              <a className="microsoft-button" href="/auth/microsoft" aria-label="Sign in with Microsoft">
                <img src="/assets/icons/ms-symbollockup_signin_light_short.svg" alt="Sign in with Microsoft" />
              </a>
            </>
          ) : null}
          {!providers.local.enabled && !providers.microsoft.enabled ? (
            <Notice>No authentication provider is currently available.</Notice>
          ) : null}
        </Card>
      </main>
    </AuthShell>
  );
}

export function SignupPage() {
  const { providers } = useSession();
  const query = useQueryNotices();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Request access · Neural Labs";
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<AuthResponse>("/api/auth/local/signup", {
        method: "POST",
        body: JSON.stringify({
          display_name: form.get("display_name"),
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      completeAuthentication(result.redirectTo);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Your access request could not be created.");
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <main className="auth-layout">
        <section className="auth-copy">
          <p className="eyebrow">Join this deployment</p>
          <h1>Request access.</h1>
          <p>Your administrator reviews every new account before workspace access is granted.</p>
        </section>
        <Card className="auth-card stack">
          <div><p className="section-kicker">Local account</p><h2>Create your account</h2></div>
          {error || query.error ? <Notice>{error ?? query.error}</Notice> : null}
          {!providers.local.enabled ? (
            <Notice>Local account registration is disabled. Return to login and use Microsoft.</Notice>
          ) : (
            <form className="stack" onSubmit={submit}>
              <Field label="Display name"><input name="display_name" type="text" maxLength={120} autoComplete="name" required /></Field>
              <Field label="Email"><input name="email" type="email" maxLength={320} autoComplete="username" required /></Field>
              <Field label="Password" hint="Use at least 12 characters."><input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></Field>
              <Button variant="primary" type="submit" disabled={submitting}>{submitting ? "Creating account…" : "Request access"}</Button>
            </form>
          )}
          <p className="form-footnote"><Link to="/login">Return to login</Link></p>
        </Card>
      </main>
    </AuthShell>
  );
}
