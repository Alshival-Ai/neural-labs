import type {
  DesktopBackgroundId,
  DesktopBackgroundPresetId,
  ProviderDraft,
  ProviderKind,
  ThemeMode,
} from "@/lib/shared/types";

export interface ProviderTemplate {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  modelPlaceholder: string;
  apiVersion?: string;
}

export const BACKGROUND_PRESETS: Array<{
  id: DesktopBackgroundPresetId;
  label: string;
  className: string;
}> = [
  {
    id: "aurora",
    label: "Aurora",
    className:
      "radial-gradient(circle at top left, rgba(86, 183, 255, 0.38), transparent 32%), radial-gradient(circle at top right, rgba(30, 214, 170, 0.24), transparent 28%), linear-gradient(180deg, #07121f 0%, #081018 58%, #03050a 100%)",
  },
  {
    id: "graphite",
    label: "Graphite",
    className:
      "radial-gradient(circle at top, rgba(255, 255, 255, 0.12), transparent 30%), linear-gradient(140deg, #1f2430 0%, #11141b 48%, #06080c 100%)",
  },
  {
    id: "sunrise-grid",
    label: "Sunrise Grid",
    className:
      "linear-gradient(135deg, #24153f 0%, #6c2459 38%, #e07c4f 100%)",
  },
  {
    id: "ocean-night",
    label: "Ocean Night",
    className:
      "radial-gradient(circle at bottom left, rgba(24, 153, 221, 0.34), transparent 30%), radial-gradient(circle at top right, rgba(42, 216, 139, 0.2), transparent 24%), linear-gradient(180deg, #08131f 0%, #061018 48%, #02070c 100%)",
  },
];

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    modelPlaceholder: "gpt-5-mini",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    modelPlaceholder: "claude-sonnet-4-20250514",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    modelPlaceholder: "openai/gpt-5-mini",
  },
  {
    id: "ollama",
    label: "Ollama",
    kind: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    modelPlaceholder: "llama3.1",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    kind: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    modelPlaceholder: "local-model",
  },
  {
    id: "azure-openai",
    label: "Azure OpenAI",
    kind: "azure-openai",
    baseUrl: "https://your-resource.openai.azure.com",
    modelPlaceholder: "deployment-name",
    apiVersion: "2024-10-21",
  },
  {
    id: "custom-openai",
    label: "Custom OpenAI-Compatible",
    kind: "openai-compatible",
    baseUrl: "http://localhost:4000/v1",
    modelPlaceholder: "custom-model",
  },
];

export function buildProviderDraft(templateId: string): ProviderDraft {
  const template =
    PROVIDER_TEMPLATES.find((entry) => entry.id === templateId) ??
    PROVIDER_TEMPLATES[0]!;

  return {
    name: template.label,
    kind: template.kind,
    model: template.modelPlaceholder,
    baseUrl: template.baseUrl,
    apiKey: "",
    apiVersion: template.apiVersion,
    deployment:
      template.kind === "azure-openai" ? template.modelPlaceholder : "",
    isDefault: false,
  };
}

export const DEFAULT_THEME: ThemeMode = "dark";
