"use client";

import { useState } from "react";

import { acceptPasswordResetRequest } from "@/lib/client/api";
import type { AuthPasswordResetRecord } from "@/lib/shared/types";

interface PasswordResetPanelProps {
  token: string;
  reset: AuthPasswordResetRecord;
}

export function PasswordResetPanel({ token, reset }: PasswordResetPanelProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setIsSubmitting(true);
    try {
      await acceptPasswordResetRequest(token, { password });
      window.location.href = "/desktop";
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to reset password");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="nl-auth-shell">
      <section className="nl-auth-card">
        <div className="nl-auth-header">
          <span>Account Recovery</span>
          <h1>Reset your password</h1>
          <p>
            Set a new password for <strong>{reset.email}</strong>.
          </p>
        </div>

        <form className="nl-auth-form" onSubmit={handleSubmit}>
          <label>
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
            />
          </label>

          <label>
            <span>Confirm password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repeat password"
              required
              minLength={8}
            />
          </label>

          {error ? <p className="nl-auth-error">{error}</p> : null}

          <button type="submit" className="nl-auth-button" disabled={isSubmitting}>
            {isSubmitting ? "Resetting..." : "Reset password"}
          </button>
        </form>

        <p className="nl-auth-footnote">
          Reset link expires {new Date(reset.expiresAt).toLocaleString()}.
        </p>
      </section>
    </main>
  );
}
