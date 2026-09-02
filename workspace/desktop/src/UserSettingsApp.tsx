import {
  Check,
  KeyRound,
  LogOut,
  Mail,
  ShieldCheck,
  Type,
  UserRound,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { FontSizeControl } from "./FontSizeControl";
import { SettingsApiError, settingsMutationHeaders, settingsRequest } from "./settingsApi";
import "./user-settings-app.css";

export type PersonalizationIdentityProvider = "local" | "microsoft";

export type PersonalizationUser = {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  role: "admin" | "user";
  status: "active" | "pending" | "rejected" | "disabled";
};

type ProviderAvailability = {
  local: { enabled: boolean };
  microsoft: { available: boolean; enabled: boolean };
};

export type PersonalizationNotice = { tone: "success" | "error"; message: string };

type PersonalizationPanelProps = {
  user: PersonalizationUser;
  providers: PersonalizationIdentityProvider[];
  csrfToken: string;
  initialNotice?: PersonalizationNotice;
  fontScale: number;
  onFontScaleChange: (value: number) => void;
  onLogout: () => void;
};

function friendlyRole(role: PersonalizationUser["role"]): string {
  return role === "admin" ? "Administrator" : "Member";
}

export function PersonalizationPanel({ user, providers: initialProviders, csrfToken, initialNotice, fontScale, onFontScaleChange, onLogout }: PersonalizationPanelProps) {
  const [providers, setProviders] = useState(initialProviders);
  const [availability, setAvailability] = useState<ProviderAvailability>();
  const [notice, setNotice] = useState<PersonalizationNotice | undefined>(initialNotice);
  const [submitting, setSubmitting] = useState(false);
  const [handle, setHandle] = useState(user.handle);
  const [savedHandle, setSavedHandle] = useState(user.handle);
  const [savingHandle, setSavingHandle] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void settingsRequest<ProviderAvailability>("/api/auth/providers")
      .then((next) => { if (!cancelled) setAvailability(next); })
      .catch(() => { if (!cancelled) setAvailability({ local: { enabled: true }, microsoft: { available: false, enabled: false } }); });
    return () => { cancelled = true; };
  }, []);

  async function linkLocalIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(undefined);
    setSubmitting(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await settingsRequest<{ provider: "local" }>("/api/account/identities/local", {
        method: "POST",
        headers: settingsMutationHeaders(csrfToken),
        body: JSON.stringify({ password: form.get("password") }),
      });
      setProviders((current) => current.includes("local") ? current : [...current, "local"]);
      setNotice({ tone: "success", message: "Local login is now linked to your account." });
      formElement.reset();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof SettingsApiError ? error.message : "Local login could not be linked.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function saveHandle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(undefined);
    setSavingHandle(true);
    try {
      const result = await settingsRequest<{ user: PersonalizationUser }>("/api/account/profile", {
        method: "PATCH",
        headers: settingsMutationHeaders(csrfToken),
        body: JSON.stringify({ handle }),
      });
      setHandle(result.user.handle);
      setSavedHandle(result.user.handle);
      setNotice({ tone: "success", message: `Your Team Chat handle is now @${result.user.handle}.` });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof SettingsApiError ? error.message : "Your handle could not be updated." });
    } finally {
      setSavingHandle(false);
    }
  }

  const microsoftLinked = providers.includes("microsoft");
  const localLinked = providers.includes("local");
  const microsoftAvailable = availability?.microsoft?.available === true && availability.microsoft.enabled === true;

  return (
    <div className="settings-panel user-settings-personalization">
      <header className="settings-section-header user-settings-heading">
        <div>
          <span><UserRound />Personal settings</span>
          <h1>Personalization</h1>
          <p>Tune the experience and manage how you sign in to this Neural Labs account.</p>
        </div>
      </header>

      {notice && (
        <div className={`user-settings-notice is-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.tone === "success" ? <Check /> : <ShieldCheck />}
          <span>{notice.message}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setNotice(undefined)}><X /></button>
        </div>
      )}

      <section className="settings-card user-settings-card user-settings-appearance-card">
          <div className="user-settings-card__heading">
            <div><span>Appearance</span><h3>Font size</h3><p>Scale readable text across every desktop app on this device.</p></div>
            <Type />
          </div>
          <div className="user-settings-font-size">
            <div className="user-settings-font-size__preview" aria-hidden="true"><span>A</span><strong>A</strong></div>
            <div><strong>Desktop text</strong><p>Window sizes, icons, and spacing stay the same.</p></div>
            <FontSizeControl value={fontScale} onChange={onFontScaleChange} />
          </div>
      </section>

      <section className="settings-card user-settings-card user-settings-identity-card">
          <div className="user-settings-card__heading">
            <div><span>Profile</span><h3>Account identity</h3></div>
            <UserRound />
          </div>
          <dl className="user-settings-identity-list">
            <div><dt>Display name</dt><dd>{user.displayName}</dd></div>
            <div><dt>Email address</dt><dd>{user.email}</dd></div>
            <div className="user-settings-handle"><dt>Team Chat handle</dt><dd><form onSubmit={saveHandle}><span>@</span><input aria-label="Team Chat handle" value={handle} minLength={2} maxLength={32} pattern="[a-z0-9][a-z0-9._-]{1,31}" onChange={(event) => setHandle(event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))} /><button type="submit" disabled={savingHandle || handle === savedHandle}>{savingHandle ? "Saving…" : "Save"}</button></form><small>Teammates mention you with this unique handle.</small></dd></div>
            <div><dt>Workspace role</dt><dd>{friendlyRole(user.role)}</dd></div>
          </dl>
      </section>

      <section className="settings-card user-settings-card">
          <div className="user-settings-card__heading">
            <div><span>Security</span><h3>Sign-in methods</h3><p>Linked methods open this same Neural Labs account.</p></div>
            <KeyRound />
          </div>

          <div className="user-settings-provider-list">
            <article>
              <div className="user-settings-provider-icon is-microsoft" aria-hidden="true"><span /><span /><span /><span /></div>
              <div><strong>Microsoft</strong><p>Use your organization’s Microsoft identity.</p></div>
              {microsoftLinked
                ? <span className="user-settings-linked"><Check />Linked</span>
                : !availability
                  ? <span className="user-settings-unavailable">Checking…</span>
                  : microsoftAvailable
                  ? <a href="/auth/microsoft?intent=link">Link Microsoft</a>
                  : <span className="user-settings-unavailable">Unavailable</span>}
            </article>

            <article>
              <div className="user-settings-provider-icon is-local" aria-hidden="true"><Mail /></div>
              <div><strong>Email &amp; password</strong><p>Use your account email with a local password.</p></div>
              {localLinked
                ? <span className="user-settings-linked"><Check />Linked</span>
                : <span className="user-settings-unavailable">Not linked</span>}
            </article>
          </div>

          {!localLinked && availability?.local?.enabled === true && (
            <form className="user-settings-password-form" onSubmit={linkLocalIdentity}>
              <label htmlFor="user-settings-password"><span>Add a local password</span><small>Use 12–128 characters.</small></label>
              <div>
                <input id="user-settings-password" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required />
                <button type="submit" disabled={submitting}>{submitting ? "Linking…" : "Link local login"}</button>
              </div>
            </form>
          )}
      </section>

      <section className="user-settings-session">
        <div><strong>Done for now?</strong><p>Sign out of Neural Labs on this device.</p></div>
        <button type="button" onClick={onLogout}><LogOut />Sign out</button>
      </section>
    </div>
  );
}
