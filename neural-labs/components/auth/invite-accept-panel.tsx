"use client";

import { useState } from "react";

import { acceptInviteRequest } from "@/lib/client/api";
import type { AuthInviteRecord } from "@/lib/shared/types";

interface InviteAcceptPanelProps {
  token: string;
  invite: AuthInviteRecord;
}

export function InviteAcceptPanel({ token, invite }: InviteAcceptPanelProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await acceptInviteRequest(token, { password });
      window.location.href = "/desktop";
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to accept invite");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="nl-auth-shell">
      <section className="nl-auth-card">
        <div className="nl-auth-card__hero">
          <img src="/brand/alshival-brain-256.png" alt="Neural Labs" />
          <div>
            <span>Invite</span>
            <h1>Activate your Neural Labs account</h1>
            <p>
              You were invited as <strong>{invite.email}</strong>. Set a password to
              access your persistent workspace.
            </p>
          </div>
        </div>

        <form className="nl-auth-form" onSubmit={handleSubmit}>
          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              required
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
            />
          </label>

          <p className="nl-auth-meta">
            Invite expires {new Date(invite.expiresAt).toLocaleString()}.
          </p>

          {error ? <p className="nl-auth-error">{error}</p> : null}

          <button type="submit" className="nl-auth-button" disabled={isSubmitting}>
            {isSubmitting ? "Activating..." : "Activate account"}
          </button>
        </form>
      </section>
    </main>
  );
}
