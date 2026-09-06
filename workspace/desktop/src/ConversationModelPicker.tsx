import { useState } from "react";
import { ModelPicker } from "./ModelPicker";
import { useModelCatalog } from "./modelProviders";
import type { NeuraGateway } from "./openclaw";
import type { SessionRow } from "./types";
import "./model-providers.css";

export function ConversationModelPicker({ gateway, session }: { gateway: NeuraGateway; session: SessionRow }) {
  const { catalog, error } = useModelCatalog("account");
  const [model, setModel] = useState(session.modelOverride ?? "");
  const [effort, setEffort] = useState(session.thinkingLevel ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const locked = session.active || session.visibility === "read-only" || session.sharingRole === "viewer";
  async function save() {
    const previousProvider = session.modelOverride?.split("/")[0] ?? "openai";
    const nextProvider = model.split("/")[0] || "openai";
    if (previousProvider !== nextProvider && !window.confirm("Changing provider sends this conversation’s context to the selected provider. Continue?")) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await gateway.patchSession(session, { model: model || null, thinkingLevel: effort || null });
      setNotice("Saved for subsequent turns. Active turns keep their current model.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Model settings could not be saved.");
    } finally { setBusy(false); }
  }
  return <details className="conversation-model-picker">
    <summary>Model</summary>
    <div className="model-provider-fields">
      <strong>Conversation settings</strong>
      <ModelPicker catalog={catalog} model={model} effort={effort} onChange={(model, effort) => { setModel(model); setEffort(effort); setNotice(undefined); }} disabled={busy || locked} error={error} defaultLabel="Personal agent default" />
      <small>A specific model is pinned to this conversation. Clearing it restores your agent default.</small>
      <button type="button" className="settings-button is-primary" disabled={busy || locked || !catalog || catalog.stale} onClick={() => void save()}>{busy ? "Saving…" : "Apply to conversation"}</button>
      {notice && <p role="status">{notice}</p>}
    </div>
  </details>;
}
