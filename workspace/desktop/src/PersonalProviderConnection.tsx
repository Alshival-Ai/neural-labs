import { Bot, Copy, ExternalLink, Pause, Play } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { SettingsApiError, settingsMutationHeaders, settingsRequest } from "./settingsApi";
import type { PersonalOpenAIAuth, PersonalizationNotice } from "./UserSettingsApp";
import "./user-settings-app.css";

export function PersonalProviderConnection({ csrfToken, team = false, refreshedStatus, onStatusChange }: { csrfToken: string; team?: boolean; refreshedStatus?: PersonalOpenAIAuth; onStatusChange?: (status: PersonalOpenAIAuth) => void }) {
  const endpoint = team ? "/api/admin/workspace/model-providers/team/connection" : "/api/account/openai";
  const [notice, setNotice] = useState<PersonalizationNotice>();
  const [openAI, setOpenAI] = useState<PersonalOpenAIAuth>();
  const [openAILoading, setOpenAILoading] = useState(true);
  const [openAIAction, setOpenAIAction] = useState<string>();
  const [apiKey, setApiKey] = useState("");
  const [keyForm, setKeyForm] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => { if (refreshedStatus) { setOpenAI(refreshedStatus); setOpenAILoading(false); } }, [refreshedStatus]);
  useEffect(() => { if (openAI) onStatusChange?.(openAI); }, [openAI, onStatusChange]);

  useEffect(() => {
    // A status response from before a mutation must not overwrite its result.
    if (openAIAction) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await settingsRequest<PersonalOpenAIAuth>(endpoint);
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
  }, [openAI?.state, endpoint, reload, openAIAction]);

  async function updateOpenAI(action: "connect" | "cancel" | "pause" | "resume") {
    setOpenAIAction(action);
    setNotice(undefined);
    try {
      const next = await settingsRequest<PersonalOpenAIAuth>(`${endpoint}/${action}`, {
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

  async function saveApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKey.trim()) return;
    setOpenAIAction("api-key");
    setNotice(undefined);
    try {
      const next = await settingsRequest<PersonalOpenAIAuth>("/api/account/openai/api-key", {
        method: "POST", headers: settingsMutationHeaders(csrfToken),
        body: JSON.stringify({ key: apiKey.trim() }),
      });
      setOpenAI(next);
      setApiKey("");
      setKeyForm(false);
      setNotice({ tone: "success", message: "OpenAI API key saved. Send a Neura message to verify access and billing." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof SettingsApiError ? error.message : "OpenAI API key could not be saved." });
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


  return <>
    {notice && <p role={notice.tone === "error" ? "alert" : "status"}>{notice.message}</p>}
      <section className="settings-card user-settings-card user-settings-openai-card">
        <div className="user-settings-card__heading">
          <div><span>{team ? "Workspace-owned connection" : "Neura"}</span><h3>{team ? "Team Neura ChatGPT account" : "Your OpenAI connection"}</h3><p>{team ? "Connect the account authorized for shared Team Neura use. This credential belongs to the dedicated team agent, not the administrator’s personal agent." : "Choose ChatGPT sign-in or your own OpenAI API key for private Neura conversations. Shared workspace configuration is managed separately."}</p></div>
          <Bot />
        </div>
        <div className="user-settings-openai-status">
          <div className={`user-settings-openai-mark is-${openAI?.paused ? "paused" : openAI?.state ?? "loading"}`} aria-hidden="true"><Bot /></div>
          <div className="user-settings-openai-copy">
            <strong>{openAIAction === "connect"
              ? "Preparing a secure sign-in code…"
              : openAILoading
              ? "Checking your connection…"
              : !openAI
                ? "Connection status unavailable"
              : openAI?.paused && openAI.authenticated
                ? "Personal Neura is paused"
                : openAI?.state === "connected"
                  ? openAI.modelReady ? openAI.authMethod === "api-key" ? "OpenAI API key configured" : "ChatGPT connected" : "Finishing model setup…"
                  : openAI?.state === "awaiting_user"
                    ? "Finish signing in with OpenAI"
                    : openAI?.state === "starting"
                      ? "Preparing a secure sign-in code…"
                  : "Connect OpenAI to use Neura"}</strong>
            <p>{openAI?.paused && openAI.authenticated
              ? "Your credential is retained and can be resumed without signing in again."
              : openAI?.state === "connected"
                ? team ? "Save Team Neura defaults below to activate this connection for new team requests." : openAI.authMethod === "api-key" ? "Only your personal Neura agent uses this API key. API usage is billed separately from ChatGPT subscriptions." : "Only your personal Neura agent uses this sign-in. System automations continue using the workspace account."
                : openAI?.state === "awaiting_user"
                  ? "Use the sign-in link and one-time code below to authorize your account."
                  : team ? "Team sign-in has its own native credential store. No personal tokens are copied." : "Connect ChatGPT or add an API key to power private Neura chats and automation Run now actions."}</p>
            {openAI?.state === "error" && openAI.message && <small className="user-settings-openai-error" role="alert">{openAI.message}</small>}
          </div>
          <div className="user-settings-openai-actions">
            {!openAILoading && !openAI && <button type="button" onClick={() => {
              setNotice(undefined);
              setOpenAILoading(true);
              setReload((value) => value + 1);
            }}>Retry connection status</button>}
            {!openAILoading && openAI?.paused && openAI.authenticated && <button type="button" onClick={() => void updateOpenAI("resume")} disabled={Boolean(openAIAction)}><Play />{openAIAction === "resume" ? "Resuming…" : "Resume"}</button>}
            {!team && !openAILoading && openAI?.state === "connected" && !openAI.paused && <button type="button" className="secondary" onClick={() => void updateOpenAI("pause")} disabled={Boolean(openAIAction)}><Pause />{openAIAction === "pause" ? "Pausing…" : "Pause"}</button>}
            {!openAILoading && (["disconnected", "error"].includes(openAI?.state ?? "") || (!team && openAI?.state === "connected" && openAI.authMethod === "api-key")) && <button type="button" onClick={() => void updateOpenAI("connect")} disabled={Boolean(openAIAction)}>{openAIAction === "connect" ? "Starting…" : openAI?.authMethod === "api-key" && openAI.state === "connected" ? "Use ChatGPT instead" : "Connect ChatGPT"}</button>}
            {!team && !openAILoading && !["starting", "awaiting_user"].includes(openAI?.state ?? "") && <button type="button" className="secondary" onClick={() => setKeyForm((shown) => !shown)} disabled={Boolean(openAIAction)}>{openAI?.authMethod === "api-key" && openAI.authenticated ? "Replace API key" : "Use an API key"}</button>}
            {!openAILoading && (openAI?.state === "starting" || openAI?.state === "awaiting_user") && <button type="button" className="secondary" onClick={() => void updateOpenAI("cancel")} disabled={Boolean(openAIAction)}>Cancel</button>}
          </div>
        </div>
        {!team && keyForm && <form className="user-settings-api-key-form" onSubmit={(event) => void saveApiKey(event)}>
          <p>Use an OpenAI Platform API key. API usage is billed separately from ChatGPT subscriptions. Saving selects key authentication for your personal Neura.</p>
          <label>OpenAI API key<input type="password" autoComplete="new-password" value={apiKey} maxLength={4096} onChange={(event) => setApiKey(event.target.value)} required placeholder="Enter an API key" /></label>
          <button type="submit" disabled={Boolean(openAIAction) || !apiKey.trim()}>{openAIAction === "api-key" ? "Saving…" : "Save and use API key"}</button>
        </form>}
        {openAI?.state === "awaiting_user" && openAI.verificationUrl && openAI.userCode && (
          <div className="user-settings-device-code" role="group" aria-label="Finish ChatGPT sign-in">
            <p>1. Open the sign-in page in a new browser tab and sign in to your ChatGPT account.</p>
            <a href={openAI.verificationUrl} target="_blank" rel="noreferrer">Open OpenAI sign-in<ExternalLink /></a>
            <p className="user-settings-device-code-url">{openAI.verificationUrl}</p>
            <p>2. Enter this one-time code on the OpenAI page.</p>
            <div className="user-settings-device-code-row">
              <div><small>One-time code</small><strong>{openAI.userCode}</strong></div>
              <button type="button" className="secondary" onClick={() => void copyOpenAICode()}><Copy />Copy code</button>
            </div>
            <p>Return here after approving sign-in. Keep this window open while Neural Labs confirms your connection.</p>
            {openAI.expiresAt && <small>Expires {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(openAI.expiresAt))}</small>}
          </div>
        )}
      </section>

  </>;
}
