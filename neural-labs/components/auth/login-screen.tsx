"use client";

import { useState } from "react";

import { EnvironmentLoader } from "@/components/auth/environment-loader";
import { login } from "@/lib/client/api";

const MINIMUM_LOADER_MS = 2000;

export function LoginScreen({ backgroundStyle }: { backgroundStyle: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    const loaderStartedAt = Date.now();

    try {
      await login({ email, password });
      const elapsedMs = Date.now() - loaderStartedAt;
      if (elapsedMs < MINIMUM_LOADER_MS) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, MINIMUM_LOADER_MS - elapsedMs)
        );
      }
      window.location.href = "/desktop";
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to sign in");
      setIsSubmitting(false);
    } finally {
    }
  }

  return (
    <main className="nl-auth-shell" style={{ backgroundImage: backgroundStyle }}>
      {isSubmitting ? <EnvironmentLoader /> : null}
      <section className="nl-auth-split">
        <div className="nl-auth-split__hero">
          <div className="nl-auth-split__hero-copy">
            <img src="/brand/alshival-brain-wide.png" alt="Neural Labs" />
            <div className="nl-auth-split__hero-text">
              <h1>Neural Labs</h1>
              <p>Your AI desktop.</p>
            </div>
            <span>Browser OS</span>
          </div>
        </div>

        <div className="nl-auth-card nl-auth-card--login">
          <div className="nl-auth-card__hero">
            <div>
              <span>Sign in</span>
              <h2>Access your workspace</h2>
              <p>Use the account attached to your invite.</p>
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
              Sign in
            </button>
          </form>

          <div className="nl-auth-card__footer">
            <p>Access is invite-only. Ask an administrator for an invite link.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
