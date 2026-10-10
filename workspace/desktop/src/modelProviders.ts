import { useEffect, useState } from "react";
import { nativeRequest, nativeSelection } from "./nativeApi";

export type ProviderModel = {
  id: string;
  name: string;
  provider: string;
  available: boolean;
  unavailableReason: string | null;
  efforts: Array<{ id: string; label: string }>;
  defaultEffort: string | null;
  supportsTools: boolean;
  input: string[];
};
export type ProviderCatalog = { agentId: string; defaultModel?: string | null; models: ProviderModel[]; fetchedAt: string; stale: boolean; message?: string; runtime?: { name: string; version: string } };

export function useModelCatalog(scope: "account" | "admin/workspace", agentId?: string) {
  const [catalog, setCatalog] = useState<ProviderCatalog>();
  const [error, setError] = useState<string>();
  const [selectionRevision, setSelectionRevision] = useState(0);
  useEffect(() => {
    const changed = () => setSelectionRevision(value => value + 1);
    window.addEventListener("neural-labs-native-selection", changed);
    return () => window.removeEventListener("neural-labs-native-selection", changed);
  }, []);
  useEffect(() => {
    let active = true;
    setCatalog(undefined);
    setError(undefined);
    const selected = nativeSelection();
    let pending = false;
    const refresh = async () => {
      if (!active || pending || document.visibilityState === "hidden") return;
      pending = true;
      try { const value = await nativeRequest<ProviderCatalog>("models.list", {}, selected); if (active) { setCatalog(value); setError(undefined); } }
      catch (error) { if (active) setError(error instanceof Error ? error.message : "Models could not be loaded."); }
      finally { pending = false; }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 5 * 60_000);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [scope, agentId, selectionRevision]);
  return { catalog, error };
}
