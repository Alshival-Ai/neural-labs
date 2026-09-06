import { Bot, Copy, ExternalLink, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsApiError, settingsMutationHeaders, settingsRequest } from "./settingsApi";
import type { PersonalOpenAIAuth, PersonalizationNotice } from "./UserSettingsApp";
import "./user-settings-app.css";

export function PersonalProviderConnection({ csrfToken, team = false, refreshedStatus }: { csrfToken: string; team?: boolean; refreshedStatus?: PersonalOpenAIAuth }) {
  const endpoint = team ? "/api/admin/workspace/model-providers/team/connection" : "/api/account/openai";
  const [notice, setNotice] = useState<PersonalizationNotice>();
  const [openAI, setOpenAI] = useState<PersonalOpenAIAuth>();
  const [openAILoading, setOpenAILoading] = useState(true);
  const [openAIAction, setOpenAIAction] = useState<string>();
  useEffect(() => { if (refreshedStatus) { setOpenAI(refreshedStatus); setOpenAILoading(false); } }, [refreshedStatus]);

  useEffect(() => {
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
  }, [openAI?.state, endpoint]);

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
          <div><span>{team ? "Workspace-owned connection" : "Neura"}</span><h3>{team ? "Team Neura ChatGPT account" : "Your ChatGPT account"}</h3><p>{team ? "Connect the account authorized for shared Team Neura use. This credential belongs to the dedicated team agent, not the administrator’s personal agent." : "Your private Neura conversations use this account. Shared workspace configuration is managed separately."}</p></div>
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
                ? team ? "Save Team Neura defaults below to activate this connection for new team requests." : "Only your personal Neura agent uses this sign-in. System automations continue using the workspace account."
                : team ? "Team sign-in has its own native credential store. No personal tokens are copied." : "Neura will not fall back to the workspace account when your personal account is unavailable."}</p>
            {openAI?.state === "error" && openAI.message && <small className="user-settings-openai-error" role="alert">{openAI.message}</small>}
          </div>
          <div className="user-settings-openai-actions">
            {!openAILoading && openAI?.paused && openAI.authenticated && <button type="button" onClick={() => void updateOpenAI("resume")} disabled={Boolean(openAIAction)}><Play />{openAIAction === "resume" ? "Resuming…" : "Resume"}</button>}
            {!team && !openAILoading && openAI?.state === "connected" && !openAI.paused && <button type="button" className="secondary" onClick={() => void updateOpenAI("pause")} disabled={Boolean(openAIAction)}><Pause />{openAIAction === "pause" ? "Pausing…" : "Pause"}</button>}
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

  </>;
}
