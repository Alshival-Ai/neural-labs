import { useEffect, useState } from "react";
import { ModelPicker } from "./ModelPicker";
import { type ProviderCatalog, useModelCatalog } from "./modelProviders";
import { settingsMutationHeaders, settingsRequest } from "./settingsApi";
import "./model-providers.css";

type Policy = { provider: "openai"; mode: "latest" | "pinned"; model: string; effort: string };
type Defaults = { policy: Policy; revision: number; resolved: { model: string | null; effort: string | null; held?: boolean } | null; pending: boolean; error: string | null };

export function ModelDefaultsPanel({ csrfToken, scope = "account", workload = "background", compact = false, updatedCatalog, onCatalog }: { csrfToken: string; scope?: "account" | "admin/workspace"; workload?: "background" | "team"; compact?: boolean; updatedCatalog?: ProviderCatalog; onCatalog?: (catalog: ProviderCatalog) => void }) {
  const team = scope === "admin/workspace" && workload === "team";
  const { catalog: initialCatalog, error: catalogError } = useModelCatalog(scope, team ? "nl-teamneura" : undefined);
  const [localCatalog, setCatalog] = useState<ProviderCatalog>();
  const catalog = updatedCatalog ?? localCatalog ?? initialCatalog;
  const [saved, setSaved] = useState<Defaults>();
  const [policy, setPolicy] = useState<Policy>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirmShared, setConfirmShared] = useState(false);
  const path = `/api/${scope}/model-providers`;
  const defaultsPath = `${path}/defaults${team ? "?workload=team" : ""}`;
  useEffect(() => { if (initialCatalog && !updatedCatalog) onCatalog?.(initialCatalog); }, [initialCatalog, onCatalog, updatedCatalog]);
  useEffect(() => {
    let active = true;
    void settingsRequest<Defaults>(defaultsPath).then((result) => {
      if (active) { setSaved(result); setPolicy(result.policy); }
    }).catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : "Model defaults could not be loaded."); });
    return () => { active = false; };
  }, [defaultsPath]);
  async function refresh() {
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const result = await settingsRequest<ProviderCatalog>(`${path}/catalog${team ? "?agentId=nl-teamneura" : ""}`, { method: "POST", headers: settingsMutationHeaders(csrfToken) });
      setCatalog(result);
      onCatalog?.(result);
      if (result.stale) throw new Error(result.message ?? "Refresh failed. Showing cached models.");
      setNotice("Models refreshed. Your selections are unchanged.");
    } catch (error) { setError(error instanceof Error ? error.message : "Refresh failed."); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!saved || !policy) return;
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const result = await settingsRequest<Defaults>(defaultsPath, { method: "PUT", headers: settingsMutationHeaders(csrfToken), body: JSON.stringify({ revision: saved.revision, policy, ...(team ? { confirmShared } : {}) }) });
      setSaved(result); setPolicy(result.policy);
      setNotice(result.pending ? "Saved, but not active yet. See the connection or compatibility issue below." : compact ? "Defaults saved for new, unpinned turns." : "Defaults applied to subsequent unpinned turns. Existing pins are unchanged.");
    } catch (error) { setError(error instanceof Error ? error.message : "Defaults could not be saved."); }
    finally { setBusy(false); }
  }
  const selectedModel = policy?.mode === "pinned" ? policy.model : saved?.resolved?.model ?? "";
  const selected = catalog?.models.find((row) => row.id === selectedModel);
  return <section className={`settings-card${compact ? " provider-defaults" : ""}`}>
    <div className="settings-card__heading"><div><span>{scope === "account" ? "Private Neura" : "Workspace policy"}</span><h2>{scope === "account" ? "Agent defaults" : team ? "Team Neura" : "Background AI"}</h2><p>{scope === "account" ? "Uses your personal ChatGPT connection." : team ? "Uses the dedicated Team Neura connection. Members do not need a personal model connection to summon her after activation." : "Uses the shared workspace OpenAI connection. Automations assigned to other agents keep those agents’ credentials and defaults."}</p></div></div>
    <div className="model-provider-fields">
      {policy && <>
        {compact ? <>
          <div className="provider-defaults-grid">
            <label><span>Default provider</span><select aria-label="Default provider" value="openai" disabled={busy} onChange={() => undefined}><option value="openai">OpenAI</option></select></label>
            <ModelPicker catalog={catalog && { ...catalog, defaultModel: selectedModel || catalog.defaultModel }} model={policy.mode === "latest" ? "" : policy.model} effort={policy.effort} disabled={busy} defaultLabel="Latest recommended model" effortDefaultLabel="Model default" onChange={(model, effort) => setPolicy({ ...policy, mode: model ? "pinned" : "latest", model, effort })} />
          </div>
          <small>{policy.mode === "latest" ? `Following the latest compatible model${saved?.resolved?.model ? ` · ${saved.resolved.model}` : ""}.` : "This model stays pinned until you change it."} Conversation overrides stay unchanged.{selected && selected.efforts.length === 0 ? " This provider does not publish reasoning options for this model." : ""}</small>
        </> : <><label><span>Model selection</span><select aria-label="Model selection" disabled={busy} value={policy.mode} onChange={(event) => setPolicy({ ...policy, mode: event.target.value as Policy["mode"], model: selectedModel, effort: "" })}><option value="latest">Follow latest compatible recommendation</option><option value="pinned">Pin a specific model</option></select></label>
        {policy.mode === "pinned" ? <ModelPicker catalog={catalog} model={policy.model} effort={policy.effort} disabled={busy} defaultLabel="Choose a model" effortDefaultLabel="Model default" onChange={(model, effort) => setPolicy({ ...policy, model, effort })} /> : <>
          <p>Current model: <strong>{saved?.resolved?.model ?? "Not resolved yet"}</strong></p>
          <label><span>Reasoning</span><select aria-label="Reasoning" value={policy.effort} disabled={busy || !selected} onChange={(event) => setPolicy({ ...policy, effort: event.target.value })}><option value="">Model default</option>{policy.effort && !selected?.efforts.some((row) => row.id === policy.effort) && <option value={policy.effort}>{policy.effort} (saved override)</option>}{selected?.efforts.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
          <small>Checked hourly. Updates remain within this provider. Explicit conversation and automation pins are never upgraded.</small>
        </>}
        </>}
        {saved?.resolved?.held && <p role="status">Keeping the previous compatible model because the latest recommendation does not support your saved reasoning level.</p>}
        {team && <label><span><input type="checkbox" checked={confirmShared} onChange={(event) => setConfirmShared(event.target.checked)} /> Use the dedicated workspace-owned Team Neura account for new team requests. Existing queued runs keep their accepted settings.</span></label>}
      </>}
      <div className="provider-defaults-actions">
        {policy && <button type="button" className="settings-button is-primary" disabled={busy || !saved || !catalog || catalog.stale || (team && !confirmShared) || (policy.mode === "pinned" && !policy.model)} onClick={() => void save()}>{busy ? "Working…" : saved?.pending ? "Retry applying defaults" : "Save defaults"}</button>}
        <button type="button" className="settings-button" disabled={busy} onClick={() => void refresh()}>Refresh models</button>
      </div>
      {(error || (!catalog && catalogError) || saved?.error) && <p role="alert">{error || (!catalog && catalogError) || saved?.error}</p>}
      {notice && <p role="status">{notice}</p>}
      {catalog && !compact && <small>Catalog checked {new Date(catalog.fetchedAt).toLocaleString()}{catalog.stale ? " · cached; refresh required before saving" : ""}</small>}
    </div>
  </section>;
}
