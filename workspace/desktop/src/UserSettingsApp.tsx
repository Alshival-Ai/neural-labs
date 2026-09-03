import {
  browserSupportsWebAuthn,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  LogOut,
  Mail,
  Pause,
  Play,
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
  passkey?: { available: boolean; enabled: boolean };
  microsoft: { available: boolean; enabled: boolean };
};

type AccountPasskey = {
  id: string;
  name: string;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

export type PersonalOpenAIAuth = {
  provider: "openai";
  authMethod: "chatgpt";
  state: "disconnected" | "starting" | "awaiting_user" | "connected" | "error";
  authenticated: boolean;
  modelReady: boolean;
  verificationUrl: string | null;
  userCode: string | null;
  expiresAt: string | null;
  message: string | null;
  agentId: string;
  paused: boolean;
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
  const [openAI, setOpenAI] = useState<PersonalOpenAIAuth>();
  const [openAILoading, setOpenAILoading] = useState(true);
  const [openAIAction, setOpenAIAction] = useState<string>();
  const [passkeys, setPasskeys] = useState<AccountPasskey[]>([]);
  const [passkeyEligible, setPasskeyEligible] = useState<boolean | null>();
  const [passkeyName, setPasskeyName] = useState("My passkey");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const passkeySupported = browserSupportsWebAuthn();

  useEffect(() => {
    let cancelled = false;
    void settingsRequest<ProviderAvailability>("/api/auth/providers")
      .then((next) => { if (!cancelled) setAvailability(next); })
      .catch(() => { if (!cancelled) setAvailability({ local: { enabled: true }, microsoft: { available: false, enabled: false } }); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void settingsRequest<{ eligible: boolean; passkeys: AccountPasskey[] }>("/api/account/passkeys")
      .then((result) => {
        if (cancelled) return;
        setPasskeyEligible(result.eligible);
        setPasskeys(result.passkeys);
      })
      .catch(() => { if (!cancelled) setPasskeyEligible(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await settingsRequest<PersonalOpenAIAuth>("/api/account/openai");
        if (!cancelled) setOpenAI(next);
      } catch (error) {
        if (!cancelled) setNotice({ tone: "error", message: error instanceof SettingsApiError ? error.message : "Your Neura account status could not be loaded." });
      } finally {
        if (!cancelled) setOpenAILoading(false);
      }
    };
    void refresh();
    const timer = openAI?.state === "starting" || openAI?.state === "awaiting_user"
      ? window.setInterval(() => void refresh(), 1_500)
      : undefined;
    return () => { cancelled = true; if (timer !== undefined) window.clearInterval(timer); };
  }, [openAI?.state]);

  async function updateOpenAI(action: "connect" | "cancel" | "pause" | "resume") {
    setOpenAIAction(action);
    setNotice(undefined);
    try {
      const next = await settingsRequest<PersonalOpenAIAuth>(`/api/account/openai/${action}`, {
        method: "POST",
        headers: settingsMutationHeaders(csrfToken),
      });
      setOpenAI(next);
      setNotice({
        tone: "success",
        message: action === "pause"
          ? "Personal Neura access is paused. Your ChatGPT sign-in is retained."
          : action === "resume"
            ? "Personal Neura access is active again."
            : action === "cancel"
              ? "OpenAI sign-in was cancelled."
              : "OpenAI sign-in started. Use the private code when it appears.",
      });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof SettingsApiError ? error.message : "Your Neura account could not be updated." });
    } finally {
      setOpenAIAction(undefined);
    }
  }

  async function copyOpenAICode() {
    if (!openAI?.userCode) return;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(openAI.userCode);
      setNotice({ tone: "success", message: "The one-time OpenAI code was copied." });
    } catch {
      setNotice({ tone: "error", message: "Copy was blocked. Select the code and copy it manually." });
    }
  }

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

  async function createPasskey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(undefined);
    setPasskeyBusy(true);
    try {
      const ceremony = await settingsRequest<{ transaction: string; options: PublicKeyCredentialCreationOptionsJSON }>(
        "/api/account/passkeys/registration/options",
        { method: "POST", headers: settingsMutationHeaders(csrfToken), body: "{}" },
      );
      const credential = await startRegistration({ optionsJSON: ceremony.options });
      const result = await settingsRequest<{ passkey: AccountPasskey }>(
        "/api/account/passkeys/registration/verify",
        {
          method: "POST",
          headers: settingsMutationHeaders(csrfToken),
          body: JSON.stringify({ transaction: ceremony.transaction, name: passkeyName, response: credential }),
        },
      );
      setPasskeys((current) => [...current, result.passkey]);
      setNotice({ tone: "success", message: `${result.passkey.name} is ready for Neural Labs sign-in.` });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof SettingsApiError ? error.message : "Passkey creation was cancelled or could not be completed.",
      });
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function removePasskey(passkey: AccountPasskey) {
    setNotice(undefined);
    setPasskeyBusy(true);
    try {
      await settingsRequest<void>(`/api/account/passkeys/${encodeURIComponent(passkey.id)}`, {
        method: "DELETE",
        headers: settingsMutationHeaders(csrfToken),
      });
      setPasskeys((current) => current.filter((item) => item.id !== passkey.id));
      setNotice({ tone: "success", message: `${passkey.name} was removed from Neural Labs.` });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof SettingsApiError ? error.message : "The passkey could not be removed." });
    } finally {
      setPasskeyBusy(false);
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

      <section className="settings-card user-settings-card user-settings-openai-card">
        <div className="user-settings-card__heading">
          <div><span>Neura</span><h3>Your ChatGPT account</h3><p>Private chats and your $Neura calls in Team Chat run with your own account.</p></div>
          <Bot />
        </div>
        <div className="user-settings-openai-status">
          <div className={`user-settings-openai-mark is-${openAI?.paused ? "paused" : openAI?.state ?? "loading"}`} aria-hidden="true"><Bot /></div>
          <div className="user-settings-openai-copy">
            <strong>{openAILoading
              ? "Checking your connection…"
              : openAI?.paused && openAI.authenticated
                ? "Personal Neura is paused"
                : openAI?.state === "connected"
                  ? openAI.modelReady ? "ChatGPT connected" : "Finishing model setup…"
                  : openAI?.state === "awaiting_user"
                    ? "Finish signing in with OpenAI"
                    : openAI?.state === "starting"
                      ? "Preparing a secure sign-in code…"
                      : "Connect ChatGPT to use Neura"}</strong>
            <p>{openAI?.paused && openAI.authenticated
              ? "Your credential is retained and can be resumed without signing in again."
              : openAI?.state === "connected"
                ? "Only your personal Neura agent uses this sign-in. System automations continue using the workspace account."
                : "Neura will not fall back to the workspace account when your personal account is unavailable."}</p>
            {openAI?.state === "error" && openAI.message && <small className="user-settings-openai-error" role="alert">{openAI.message}</small>}
          </div>
          <div className="user-settings-openai-actions">
            {!openAILoading && openAI?.paused && openAI.authenticated && <button type="button" onClick={() => void updateOpenAI("resume")} disabled={Boolean(openAIAction)}><Play />{openAIAction === "resume" ? "Resuming…" : "Resume"}</button>}
            {!openAILoading && openAI?.state === "connected" && !openAI.paused && <button type="button" className="secondary" onClick={() => void updateOpenAI("pause")} disabled={Boolean(openAIAction)}><Pause />{openAIAction === "pause" ? "Pausing…" : "Pause"}</button>}
            {!openAILoading && ["disconnected", "error"].includes(openAI?.state ?? "") && <button type="button" onClick={() => void updateOpenAI("connect")} disabled={Boolean(openAIAction)}>{openAIAction === "connect" ? "Starting…" : "Connect ChatGPT"}</button>}
            {!openAILoading && (openAI?.state === "starting" || openAI?.state === "awaiting_user") && <button type="button" className="secondary" onClick={() => void updateOpenAI("cancel")} disabled={Boolean(openAIAction)}>Cancel</button>}
          </div>
        </div>
        {openAI?.state === "awaiting_user" && openAI.verificationUrl && openAI.userCode && (
          <div className="user-settings-device-code">
            <div><small>One-time code</small><strong>{openAI.userCode}</strong></div>
            <button type="button" className="secondary" onClick={() => void copyOpenAICode()}><Copy />Copy code</button>
            <a href={openAI.verificationUrl} target="_blank" rel="noreferrer">Open OpenAI sign-in<ExternalLink /></a>
            {openAI.expiresAt && <small>Expires {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(openAI.expiresAt))}</small>}
          </div>
        )}
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

            <article>
              <div className="user-settings-provider-icon is-passkey" aria-hidden="true"><KeyRound /></div>
              <div><strong>Passkeys</strong><p>Use your device unlock instead of a password.</p></div>
              {!microsoftLinked
                ? <span className="user-settings-unavailable">Microsoft required</span>
                : passkeyEligible === undefined
                  ? <span className="user-settings-unavailable">Checking…</span>
                  : passkeyEligible === null
                    ? <span className="user-settings-unavailable">Unavailable</span>
                    : !passkeyEligible
                      ? <span className="user-settings-unavailable">Microsoft required</span>
                : !passkeySupported
                  ? <span className="user-settings-unavailable">Unsupported here</span>
                  : <span className="user-settings-linked"><Check />{passkeys.length} ready</span>}
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

          {microsoftLinked && passkeyEligible === true && passkeySupported && (
            <div className="user-settings-passkeys">
              {passkeys.length > 0 && <ul aria-label="Your passkeys">{passkeys.map((passkey) => (
                <li key={passkey.id}>
                  <div><strong>{passkey.name}</strong><small>{passkey.backedUp ? "Synced passkey" : "Device-bound passkey"} · added {new Date(passkey.createdAt).toLocaleDateString()}</small></div>
                  <button type="button" disabled={passkeyBusy} onClick={() => void removePasskey(passkey)}>Remove</button>
                </li>
              ))}</ul>}
              <form className="user-settings-passkey-form" onSubmit={createPasskey}>
                <label htmlFor="user-settings-passkey-name"><span>Create a passkey</span><small>Microsoft must already be linked to this account.</small></label>
                <div>
                  <input id="user-settings-passkey-name" aria-label="Passkey name" value={passkeyName} minLength={1} maxLength={80} onChange={(event) => setPasskeyName(event.target.value)} required />
                  <button type="submit" disabled={passkeyBusy}>{passkeyBusy ? "Waiting for device…" : "Create passkey"}</button>
                </div>
              </form>
            </div>
          )}
      </section>

      <section className="user-settings-session">
        <div><strong>Done for now?</strong><p>Sign out of Neural Labs on this device.</p></div>
        <button type="button" onClick={onLogout}><LogOut />Sign out</button>
      </section>
    </div>
  );
}
