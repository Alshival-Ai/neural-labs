import { useEffect, useState } from "react";
import { settingsMutationHeaders, settingsRequest } from "./settingsApi";

type VoiceSettings = {
  revision: number; realtimeModel: string; transcriptionModel: string; realtimeVoice: string;
  configured: boolean; pending: boolean; error: string | null; catalogCheckedAt: string | null;
  realtimeModels: Array<{ id: string; available: boolean | null }>;
  transcriptionModels: Array<{ id: string; available: boolean | null }>;
  voices: string[];
};
const endpoint = "/api/admin/workspace/model-providers/voice";

export function VoiceSettingsPanel({ csrfToken }: { csrfToken: string }) {
  const [settings, setSettings] = useState<VoiceSettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    let active = true;
    void settingsRequest<VoiceSettings>(endpoint).then((result) => { if (active) setSettings(result); }).catch(() => { if (active) setError("Voice settings could not be loaded."); });
    return () => { active = false; };
  }, []);
  async function update(refresh = false) {
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const result = await settingsRequest<VoiceSettings>(`${endpoint}${refresh ? "/refresh" : ""}`, { method: refresh ? "POST" : "PUT", headers: settingsMutationHeaders(csrfToken), ...(!refresh && settings ? { body: JSON.stringify({ revision: settings.revision, settings: { realtimeModel: settings.realtimeModel, transcriptionModel: settings.transcriptionModel, realtimeVoice: settings.realtimeVoice } }) } : {}) });
      setSettings(result);
      setNotice(refresh ? "Model availability refreshed." : result.pending ? "Saved, but not active yet." : "Voice settings applied to new calls and memos. Existing calls are unchanged.");
    } catch (error) { setError(error instanceof Error ? error.message : "Voice settings could not be updated."); }
    finally { setBusy(false); }
  }
  const modelField = (field: "realtimeModel" | "transcriptionModel", label: string, rows: VoiceSettings["realtimeModels"]) => settings && <label><span>{label}</span><select aria-label={label} disabled={busy} value={settings[field]} onChange={(event) => setSettings({ ...settings, [field]: event.target.value })}>
    {!rows.some((row) => row.id === settings[field]) && <option value={settings[field]}>{settings[field]} (existing pin)</option>}
    {rows.map((row) => <option key={row.id} value={row.id} disabled={row.available === false}>{row.id}{row.available === false ? " (unavailable)" : row.available === null ? " (not checked)" : ""}</option>)}
  </select></label>;
  return <section className="settings-card">
    <div className="settings-card__heading"><div><span>Audio service</span><h2>Voice</h2><p>Realtime calls and uploaded voice memos use the workspace OpenAI API key, independently of personal and team chat subscriptions.</p></div></div>
    <div className="model-provider-fields">
      <p>{settings?.configured ? "Workspace API key configured. Availability checks do not place a call." : "Voice requires a workspace OpenAI API key. A ChatGPT or Claude subscription does not supply this audio connection."}</p>
      {settings && <>
        {modelField("realtimeModel", "Realtime voice model", settings.realtimeModels)}
        {modelField("transcriptionModel", "Voice memo transcription model", settings.transcriptionModels)}
        <label><span>Voice</span><select aria-label="Voice" disabled={busy} value={settings.realtimeVoice} onChange={(event) => setSettings({ ...settings, realtimeVoice: event.target.value })}>{!settings.voices.includes(settings.realtimeVoice) && <option>{settings.realtimeVoice}</option>}{settings.voices.map((voice) => <option key={voice}>{voice}</option>)}</select></label>
        <button type="button" className="settings-button is-primary" disabled={busy || !settings.configured} onClick={() => void update()}>{busy ? "Working…" : "Save voice settings"}</button>
      </>}
      <button type="button" className="settings-button" disabled={busy || !settings?.configured} onClick={() => void update(true)}>Check voice model availability</button>
      {(error || settings?.error) && <p role="alert">{error || settings?.error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
  </section>;
}
