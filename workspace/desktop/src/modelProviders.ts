import { useEffect, useState } from "react";
import { settingsRequest } from "./settingsApi";

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
  useEffect(() => {
    let active = true;
    setCatalog(undefined);
    setError(undefined);
    void settingsRequest<ProviderCatalog>(`/api/${scope}/model-providers/catalog${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""}`)
      .then((value) => { if (active) setCatalog(value); })
      .catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : "Models could not be loaded."); });
    return () => { active = false; };
  }, [scope, agentId]);
  return { catalog, error };
}
