import type { ProviderCatalog } from "./modelProviders";

export function ModelPicker({ catalog, model, effort, onChange, disabled = false, defaultLabel = "Agent default", effortDefaultLabel = "Inherit agent reasoning", error }: {
  catalog?: ProviderCatalog;
  model: string;
  effort: string;
  onChange: (model: string, effort: string) => void;
  disabled?: boolean;
  defaultLabel?: string;
  effortDefaultLabel?: string;
  error?: string;
}) {
  const selected = catalog?.models.find((row) => row.id === (model || catalog.defaultModel));
  const efforts = selected?.efforts ?? [];
  return <>
    <label><span>Model</span><select aria-label="Model" disabled={disabled || !catalog} value={model} onChange={(event) => onChange(event.target.value, "")}>
      <option value="">{defaultLabel}</option>
      {model && !selected && <option value={model}>{model} (not in current catalog)</option>}
      {catalog?.models.map((row) => <option key={row.id} value={row.id} disabled={!row.available}>{row.name} · {row.provider}{row.available ? "" : " (unavailable)"}</option>)}
    </select></label>
    <label><span>Reasoning</span><select aria-label="Reasoning" disabled={disabled || !selected} value={effort} onChange={(event) => onChange(model, event.target.value)}>
      <option value="">{effortDefaultLabel}</option>
      {effort && !efforts.some((row) => row.id === effort) && <option value={effort}>{effort} (saved override)</option>}
      {efforts.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
    </select></label>
    {error && <p role="alert">{error}</p>}
    {catalog?.stale && <p role="status">{catalog.message ?? "Showing a cached model catalog."}</p>}
  </>;
}
