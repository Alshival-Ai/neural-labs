"use client";

import { useState } from "react";

import {
  createInviteRequest,
  logout,
  revokeInviteRequest,
} from "@/lib/client/api";
import type { AuthInviteRecord, AuthRole, AuthViewer } from "@/lib/shared/types";

interface AdminPanelProps {
  viewer: AuthViewer;
  initialInvites: AuthInviteRecord[];
}

function inviteStatus(invite: AuthInviteRecord): string {
  if (invite.revokedAt) {
    return "Revoked";
  }
  if (invite.acceptedAt) {
    return "Accepted";
  }
  if (new Date(invite.expiresAt).getTime() <= Date.now()) {
    return "Expired";
  }
  return "Active";
}

export function AdminPanel({ viewer, initialInvites }: AdminPanelProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AuthRole>("user");
  const [invites, setInvites] = useState(initialInvites);
  const [error, setError] = useState("");
  const [latestInviteUrl, setLatestInviteUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function handleCreateInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    setLatestInviteUrl("");

    try {
      const created = await createInviteRequest({ email, role });
      setInvites((current) => [
        {
          id: created.id,
          email: created.email,
          role: created.role,
          createdAt: created.createdAt,
          expiresAt: created.expiresAt,
          acceptedAt: created.acceptedAt,
          revokedAt: created.revokedAt,
        },
        ...current.filter((invite) => invite.email !== created.email),
      ]);
      setLatestInviteUrl(created.invitationUrl);
      setEmail("");
      setRole("user");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create invite");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    setRevokingId(inviteId);
    setError("");

    try {
      await revokeInviteRequest(inviteId);
      setInvites((current) =>
        current.map((invite) =>
          invite.id === inviteId
            ? { ...invite, revokedAt: new Date().toISOString() }
            : invite
        )
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to revoke invite");
    } finally {
      setRevokingId(null);
    }
  }

  async function handleLogout() {
    await logout();
    window.location.href = "/login";
  }

  return (
    <main className="nl-auth-shell">
      <section className="nl-auth-card nl-auth-card--wide">
        <div className="nl-auth-admin__header">
          <div>
            <span>Admin</span>
            <h1>Manage Neural Labs access</h1>
            <p>Signed in as {viewer.email}</p>
          </div>

          <div className="nl-auth-admin__actions">
            <a className="nl-auth-link" href="/desktop">
              Open desktop
            </a>
            <button type="button" className="nl-auth-button nl-auth-button--ghost" onClick={() => void handleLogout()}>
              Sign out
            </button>
          </div>
        </div>

        <form className="nl-auth-form nl-auth-form--row" onSubmit={handleCreateInvite}>
          <label>
            <span>Invite email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@example.com"
              required
            />
          </label>

          <label>
            <span>Role</span>
            <select value={role} onChange={(event) => setRole(event.target.value as AuthRole)}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <button type="submit" className="nl-auth-button" disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create invite"}
          </button>
        </form>

        {latestInviteUrl ? (
          <div className="nl-auth-callout">
            <strong>Invite link</strong>
            <p>{latestInviteUrl}</p>
            <button
              type="button"
              className="nl-auth-link-button"
              onClick={() => navigator.clipboard.writeText(latestInviteUrl)}
            >
              Copy link
            </button>
          </div>
        ) : null}

        {error ? <p className="nl-auth-error">{error}</p> : null}

        <div className="nl-auth-table">
          <div className="nl-auth-table__header">
            <span>Email</span>
            <span>Role</span>
            <span>Status</span>
            <span>Expires</span>
            <span />
          </div>

          {invites.length === 0 ? (
            <div className="nl-auth-table__empty">No invites created yet.</div>
          ) : (
            invites.map((invite) => (
              <div key={invite.id} className="nl-auth-table__row">
                <span>{invite.email}</span>
                <span>{invite.role}</span>
                <span>{inviteStatus(invite)}</span>
                <span>{new Date(invite.expiresAt).toLocaleString()}</span>
                <span>
                  {!invite.acceptedAt && !invite.revokedAt ? (
                    <button
                      type="button"
                      className="nl-auth-link-button"
                      disabled={revokingId === invite.id}
                      onClick={() => void handleRevokeInvite(invite.id)}
                    >
                      {revokingId === invite.id ? "Revoking..." : "Revoke"}
                    </button>
                  ) : null}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
