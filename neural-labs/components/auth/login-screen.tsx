"use client";

import { useState } from "react";

import { bootstrapAdmin, login } from "@/lib/client/api";

interface LoginScreenProps {
  canBootstrapAdmin: boolean;
  bootstrapAdminEmail: string | null;
}

export function LoginScreen({
  canBootstrapAdmin,
  bootstrapAdminEmail,
}: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bootstrapPassword, setBootstrapPassword] = useState("");
  const [bootstrapConfirm, setBootstrapConfirm] = useState("");
  const [bootstrapError, setBootstrapError] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(false);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      await login({ email, password });
      window.location.href = "/desktop";
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to sign in");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleBootstrap(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (bootstrapPassword !== bootstrapConfirm) {
      setBootstrapError("Passwords do not match");
      return;
    }

    setIsBootstrapping(true);
    setBootstrapError("");

    try {
      await bootstrapAdmin({
        email: bootstrapAdminEmail ?? "",
        password: bootstrapPassword,
      });
      window.location.href = "/desktop";
    } catch (nextError) {
      setBootstrapError(
        nextError instanceof Error ? nextError.message : "Unable to create admin account"
      );
    } finally {
      setIsBootstrapping(false);
    }
  }

  return (
    <main className="nl-auth-shell">
      <section className="nl-auth-card">
        <div className="nl-auth-card__hero">
          <img src="/brand/alshival-brain-256.png" alt="Neural Labs" />
          <div>
            <span>Neural Labs</span>
            <h1>Sign in to your workspace</h1>
            <p>
              Workspace files, editor changes, terminal sessions, and conversations are
              stored against your account.
            </p>
          </div>
        </div>

        <form className="nl-auth-form" onSubmit={handleLogin}>
          <label>
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>

          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
            />
          </label>

          {error ? <p className="nl-auth-error">{error}</p> : null}

          <button type="submit" className="nl-auth-button" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="nl-auth-card__footer">
          <p>Access is invite-only. Ask an administrator for an invite link.</p>
        </div>
      </section>

      {canBootstrapAdmin && bootstrapAdminEmail ? (
        <section className="nl-auth-card nl-auth-card--secondary">
          <div className="nl-auth-card__hero">
            <div>
              <span>Bootstrap Admin</span>
              <h2>Create the first admin account</h2>
              <p>
                No users exist yet. The first admin must use{" "}
                <strong>{bootstrapAdminEmail}</strong>.
              </p>
            </div>
          </div>

          <form className="nl-auth-form" onSubmit={handleBootstrap}>
            <label>
              <span>Admin email</span>
              <input type="email" value={bootstrapAdminEmail} disabled readOnly />
            </label>

            <label>
              <span>Password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={bootstrapPassword}
                onChange={(event) => setBootstrapPassword(event.target.value)}
                placeholder="At least 8 characters"
                required
              />
            </label>

            <label>
              <span>Confirm password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={bootstrapConfirm}
                onChange={(event) => setBootstrapConfirm(event.target.value)}
                placeholder="Repeat password"
                required
              />
            </label>

            {bootstrapError ? <p className="nl-auth-error">{bootstrapError}</p> : null}

            <button
              type="submit"
              className="nl-auth-button"
              disabled={isBootstrapping}
            >
              {isBootstrapping ? "Creating admin..." : "Create admin account"}
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
