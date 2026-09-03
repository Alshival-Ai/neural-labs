import {
  browserSupportsWebAuthn,
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api, ApiError } from "../api";
import { useSession } from "../App";
import { AuthIntro, AuthShell, Button, Card, Field, Notice } from "../components";
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

function MicrosoftButton() {
  return (
    <div className="auth-provider-row">
      <a className="microsoft-button" href="/auth/microsoft" aria-label="Sign in with Microsoft">
        <img src="/assets/icons/ms-symbollockup_signin_light_short.svg" alt="" />
      </a>
    </div>
  );
}

export function LoginPage() {
  const { providers } = useSession();
  const query = useQueryNotices();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "methods" | "password">(
    providers.local.enabled ? "email" : "methods",
  );
  const passkeyAvailable = providers.passkey?.enabled === true && browserSupportsWebAuthn();

  useEffect(() => {
    document.title = "Sign in · Neural Labs";
  }, []);

  function continueWithEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setStep(passkeyAvailable ? "methods" : "password");
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<AuthResponse>("/api/auth/local/login", {
        method: "POST",
        body: JSON.stringify({ email, password: form.get("password") }),
      });
      completeAuthentication(result.redirectTo);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Sign-in could not be completed.");
      setSubmitting(false);
    }
  }

  async function usePasskey() {
    setError(undefined);
    setPasskeySubmitting(true);
    try {
      const ceremony = await api<{ transaction: string; options: PublicKeyCredentialRequestOptionsJSON }>(
        "/api/auth/passkey/options",
        { method: "POST", body: "{}" },
      );
      const credential = await startAuthentication({ optionsJSON: ceremony.options });
      const result = await api<AuthResponse>("/api/auth/passkey/verify", {
        method: "POST",
        body: JSON.stringify({ transaction: ceremony.transaction, response: credential }),
      });
      completeAuthentication(result.redirectTo);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Passkey sign-in was cancelled or could not be completed.");
      setPasskeySubmitting(false);
    }
  }

  return (
    <AuthShell>
      <main className="auth-layout">
        <AuthIntro eyebrow="Private AI workspace" title="Welcome back." accent="Neural Labs">
          Return to the shared workspace, tools, and working context your team keeps together.
        </AuthIntro>

        <Card className="auth-card stack">
          <div className="auth-card-heading">
            <p className="section-kicker">Neural Labs account</p>
            <h2>Sign in</h2>
            <p>Choose how you access this workspace.</p>
          </div>

          {error || query.error ? <Notice>{error ?? query.error}</Notice> : null}
          {query.success ? <Notice tone="success">{query.success}</Notice> : null}

          {providers.local.enabled && step === "email" ? (
            <form className="auth-email-entry" onSubmit={continueWithEmail}>
              <Field label="Email address">
                <input
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  autoComplete="username"
                  required
                  autoFocus
                />
              </Field>
              <Button variant="primary" type="submit">Continue <span aria-hidden="true">→</span></Button>
            </form>
          ) : null}

          {providers.local.enabled && step !== "email" ? (
            <div className="auth-method-step">
              <div className="auth-email-summary">
                <div><span>Continue as</span><strong>{email}</strong></div>
                <button type="button" onClick={() => { setStep("email"); setError(undefined); }}>Change</button>
              </div>

              {step === "methods" ? (
                <div className="auth-method-list">
                  <p className="auth-method-label">Choose a sign-in method</p>
                  {passkeyAvailable ? (
                    <Button
                      className="auth-method-button auth-method-primary"
                      variant="primary"
                      type="button"
                      disabled={passkeySubmitting}
                      onClick={() => void usePasskey()}
                    >
                      <span><i aria-hidden="true">◇</i><strong>{passkeySubmitting ? "Checking passkey…" : "Use a passkey"}</strong></span>
                      <b aria-hidden="true">→</b>
                    </Button>
                  ) : null}
                  <Button className="auth-method-button" variant="secondary" type="button" onClick={() => setStep("password")}>
                    <span><i aria-hidden="true">●</i><strong>Use your password</strong></span>
                    <b aria-hidden="true">→</b>
                  </Button>
                </div>
              ) : (
                <form className="auth-password-form" onSubmit={submitPassword}>
                  <Field label="Password">
                    <input name="password" type="password" autoComplete="current-password" required autoFocus />
                  </Field>
                  <Button variant="primary" type="submit" disabled={submitting}>
                    {submitting ? "Signing in…" : <>Sign in <span aria-hidden="true">→</span></>}
                  </Button>
                  {passkeyAvailable ? <button className="auth-text-button" type="button" onClick={() => setStep("methods")}>Choose another method</button> : null}
                </form>
              )}
            </div>
          ) : null}

          {!providers.local.enabled && passkeyAvailable ? (
            <Button className="passkey-button" variant="primary" type="button" disabled={passkeySubmitting} onClick={() => void usePasskey()}>
              <span aria-hidden="true">◇</span>{passkeySubmitting ? "Checking passkey…" : "Use a passkey"}
            </Button>
          ) : null}

          {providers.microsoft.enabled ? (
            <>
              {providers.local.enabled || passkeyAvailable ? <div className="divider"><span>or use a connected identity</span></div> : null}
              <MicrosoftButton />
            </>
          ) : null}

          {!providers.local.enabled && !providers.microsoft.enabled && !passkeyAvailable ? (
            <Notice>No authentication provider is currently available.</Notice>
          ) : null}

          {providers.local.enabled ? <p className="form-footnote">New to Neural Labs? <Link to="/signup">Request access</Link>.</p> : null}
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
    if (form.get("password") !== form.get("password_confirm")) {
      setError("Passwords do not match.");
      setSubmitting(false);
      return;
    }
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
      <main className="auth-layout auth-layout-signup">
        <AuthIntro eyebrow="Join this deployment" title="Your workspace." accent="By invitation.">
          Create an identity for this Neural Labs deployment. An administrator approves access before the workspace opens.
        </AuthIntro>

        <Card className="auth-card stack">
          <div className="auth-card-heading">
            <p className="section-kicker">Neural Labs account</p>
            <h2>Request access</h2>
            <p>Register locally or use your organization identity.</p>
          </div>
          {error || query.error ? <Notice>{error ?? query.error}</Notice> : null}
          {!providers.local.enabled ? (
            <Notice tone="info">Local registration is disabled. Use the Microsoft identity connected to this deployment.</Notice>
          ) : (
            <form className="auth-signup-form" onSubmit={submit}>
              <Field label="Display name"><input name="display_name" type="text" maxLength={120} autoComplete="name" required /></Field>
              <Field label="Email address"><input name="email" type="email" maxLength={320} autoComplete="username" required /></Field>
              <div className="auth-field-pair">
                <Field label="Password" hint="At least 12 characters."><input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></Field>
                <Field label="Confirm password"><input name="password_confirm" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></Field>
              </div>
              <Button variant="primary" type="submit" disabled={submitting}>{submitting ? "Creating account…" : "Request access"}</Button>
            </form>
          )}
          {providers.microsoft.enabled ? (
            <>
              <div className="divider"><span>or use a connected identity</span></div>
              <MicrosoftButton />
            </>
          ) : null}
          <p className="form-footnote"><Link to="/login">Already have access? Sign in</Link></p>
        </Card>
      </main>
    </AuthShell>
  );
}
