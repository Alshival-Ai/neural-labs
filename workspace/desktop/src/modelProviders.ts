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
    void nativeRequest<ProviderCatalog>("models.list", {}, selected)
      .then((value) => { if (active) setCatalog(value); })
      .catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : "Models could not be loaded."); });
    return () => { active = false; };
  }, [scope, agentId, selectionRevision]);
  return { catalog, error };
}
