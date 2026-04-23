import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  DEFAULT_THEME,
  PROVIDER_TEMPLATES,
} from "@/lib/shared/providers";
import type {
  ConversationRecord,
  DesktopBackgroundId,
  DesktopSettings,
  ProviderDraft,
  ProviderManagedKey,
  ProviderRecord,
  ProviderKind,
  SettingsSnapshot,
} from "@/lib/shared/types";
import {
  getDataRoot,
  getStateFilePath,
  getWorkspaceRoot,
} from "@/lib/server/paths";

interface PersistedState {
  settings: DesktopSettings;
  providers: ProviderRecord[];
  conversations: ConversationRecord[];
}

interface EnvProviderConfig {
  managedKey: ProviderManagedKey;
  name: string;
  kind: ProviderKind;
  model: string;
  baseUrl: string;
  apiKey: string;
  apiVersion?: string;
  deployment?: string;
}

let hasReconciledEnvProviders = false;

const DEFAULT_SETTINGS: DesktopSettings = {
  theme:
    process.env.NEURAL_LABS_THEME === "light" ||
    process.env.NEURAL_LABS_THEME === "dark" ||
    process.env.NEURAL_LABS_THEME === "system"
      ? process.env.NEURAL_LABS_THEME
      : DEFAULT_THEME,
  backgroundId:
    process.env.NEURAL_LABS_BACKGROUND_ID === "graphite" ||
    process.env.NEURAL_LABS_BACKGROUND_ID === "sunrise-grid" ||
    process.env.NEURAL_LABS_BACKGROUND_ID === "ocean-night" ||
    process.env.NEURAL_LABS_BACKGROUND_ID === "aurora"
      ? process.env.NEURAL_LABS_BACKGROUND_ID
      : "aurora",
  customBackgroundPath: null,
};

function isValidBackgroundId(value: string | undefined): value is DesktopBackgroundId {
  return (
    value === "aurora" ||
    value === "graphite" ||
    value === "sunrise-grid" ||
    value === "ocean-night" ||
    value?.startsWith("custom:") === true
  );
}

function normalizeSettings(settings: DesktopSettings): DesktopSettings {
  const backgroundId = isValidBackgroundId(settings.backgroundId)
    ? settings.backgroundId
    : DEFAULT_SETTINGS.backgroundId;
  const customBackgroundPath =
    typeof settings.customBackgroundPath === "string" &&
    settings.customBackgroundPath.trim()
      ? settings.customBackgroundPath.trim()
      : null;

  if (backgroundId.startsWith("custom:")) {
    const selectedPath = backgroundId.slice("custom:".length);
    const nextPath = customBackgroundPath ?? selectedPath ?? null;
    if (!nextPath) {
      return {
        ...settings,
        backgroundId: DEFAULT_SETTINGS.backgroundId,
        customBackgroundPath: null,
      };
    }
    return {
      ...settings,
      backgroundId: `custom:${nextPath}`,
      customBackgroundPath: nextPath,
    };
  }

  return {
    ...settings,
    backgroundId,
    customBackgroundPath,
  };
}

function getTemplateByKind(kind: ProviderKind | string | undefined) {
  if (!kind) {
    return PROVIDER_TEMPLATES[0]!;
  }

  return (
    PROVIDER_TEMPLATES.find((template) => template.kind === kind) ??
    PROVIDER_TEMPLATES[0]!
  );
}

function getValidatedProviderKind(
  kind: string | undefined
): ProviderKind | undefined {
  if (
    kind === "openai" ||
    kind === "anthropic" ||
    kind === "openai-compatible" ||
    kind === "azure-openai"
  ) {
    return kind;
  }
  return undefined;
}

function getEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function createProviderRecord(
  config: EnvProviderConfig,
  now: string,
  isDefault: boolean
): ProviderRecord {
  return {
    id: randomUUID(),
    name: config.name,
    kind: config.kind,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    apiVersion: config.apiVersion,
    deployment: config.deployment,
    isDefault,
    managedBy: "env",
    managedKey: config.managedKey,
    createdAt: now,
    updatedAt: now,
  };
}

function buildEnvProviderConfigs(): EnvProviderConfig[] {
  const openAiTemplate = getTemplateByKind("openai");
  const anthropicTemplate = getTemplateByKind("anthropic");
  const configs: EnvProviderConfig[] = [];

  const openAiApiKey = getEnvValue("OPENAI_DEFAULT_API_KEY");
  if (openAiApiKey) {
    configs.push({
      managedKey: "openai-default",
      name: getEnvValue("OPENAI_DEFAULT_NAME") || openAiTemplate.label,
      kind: "openai",
      model: getEnvValue("OPENAI_DEFAULT_MODEL") || openAiTemplate.modelPlaceholder,
      baseUrl: getEnvValue("OPENAI_DEFAULT_BASE_URL") || openAiTemplate.baseUrl,
      apiKey: openAiApiKey,
    });
  }

  const anthropicApiKey = getEnvValue("ANTHROPIC_DEFAULT_API_KEY");
  if (anthropicApiKey) {
    configs.push({
      managedKey: "anthropic-default",
      name: getEnvValue("ANTHROPIC_DEFAULT_NAME") || anthropicTemplate.label,
      kind: "anthropic",
      model:
        getEnvValue("ANTHROPIC_DEFAULT_MODEL") ||
        anthropicTemplate.modelPlaceholder,
      baseUrl:
        getEnvValue("ANTHROPIC_DEFAULT_BASE_URL") || anthropicTemplate.baseUrl,
      apiKey: anthropicApiKey,
    });
  }

  if (configs.length > 0) {
    return configs;
  }

  const legacyKind = getValidatedProviderKind(getEnvValue("NEURAL_LABS_PROVIDER_KIND"));
  const legacyConfigured = Boolean(
    legacyKind ||
      getEnvValue("NEURAL_LABS_PROVIDER_NAME") ||
      getEnvValue("NEURAL_LABS_PROVIDER_MODEL") ||
      getEnvValue("NEURAL_LABS_PROVIDER_BASE_URL") ||
      getEnvValue("NEURAL_LABS_PROVIDER_API_KEY") ||
      getEnvValue("NEURAL_LABS_PROVIDER_API_VERSION") ||
      getEnvValue("NEURAL_LABS_PROVIDER_DEPLOYMENT")
  );
  if (!legacyConfigured) {
    return [];
  }

  const template = getTemplateByKind(legacyKind);
  return [
    {
      managedKey: "legacy-default",
      name: getEnvValue("NEURAL_LABS_PROVIDER_NAME") || template.label,
      kind: legacyKind || template.kind,
      model:
        getEnvValue("NEURAL_LABS_PROVIDER_MODEL") || template.modelPlaceholder,
      baseUrl:
        getEnvValue("NEURAL_LABS_PROVIDER_BASE_URL") || template.baseUrl,
      apiKey: getEnvValue("NEURAL_LABS_PROVIDER_API_KEY") || "",
      apiVersion:
        getEnvValue("NEURAL_LABS_PROVIDER_API_VERSION") || template.apiVersion,
      deployment: getEnvValue("NEURAL_LABS_PROVIDER_DEPLOYMENT"),
    },
  ];
}

function resolveEnvDefaultManagedKey(
  configs: EnvProviderConfig[]
): ProviderManagedKey | null {
  if (configs.length === 0) {
    return null;
  }
  if (configs.length === 1) {
    return configs[0]!.managedKey;
  }

  const requestedDefault = getEnvValue("NEURAL_LABS_DEFAULT_PROVIDER");
  if (requestedDefault === "openai") {
    return (
      configs.find((config) => config.managedKey === "openai-default")?.managedKey ??
      null
    );
  }
  if (requestedDefault === "anthropic") {
    return (
      configs.find((config) => config.managedKey === "anthropic-default")
        ?.managedKey ?? null
    );
  }

  return (
    configs.find((config) => config.managedKey === "openai-default")?.managedKey ??
    configs.find((config) => config.managedKey === "anthropic-default")?.managedKey ??
    configs[0]!.managedKey
  );
}

function createFallbackProvider(): ProviderRecord {
  const template = getTemplateByKind(undefined);
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    name: template.label,
    kind: template.kind,
    model: template.modelPlaceholder,
    baseUrl: template.baseUrl,
    apiKey: "",
    apiVersion: template.apiVersion,
    deployment: undefined,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

function buildInitialProviders(): ProviderRecord[] {
  const envConfigs = buildEnvProviderConfigs();
  if (envConfigs.length === 0) {
    return [createFallbackProvider()];
  }

  const now = new Date().toISOString();
  const defaultManagedKey = resolveEnvDefaultManagedKey(envConfigs);
  return envConfigs.map((config) =>
    createProviderRecord(config, now, config.managedKey === defaultManagedKey)
  );
}

function reconcileStateWithEnvProviders(state: PersistedState): PersistedState {
  const envConfigs = buildEnvProviderConfigs();
  if (envConfigs.length === 0) {
    return state;
  }

  const nextProviders = state.providers.filter(
    (provider) =>
      provider.managedBy !== "env" ||
      envConfigs.some((config) => config.managedKey === provider.managedKey)
  );

  const now = new Date().toISOString();
  envConfigs.forEach((config) => {
    const existingIndex = nextProviders.findIndex(
      (provider) =>
        provider.managedBy === "env" && provider.managedKey === config.managedKey
    );

    if (existingIndex === -1) {
      nextProviders.push(createProviderRecord(config, now, false));
      return;
    }

    const existing = nextProviders[existingIndex]!;
    nextProviders[existingIndex] = {
      ...existing,
      name: config.name,
      kind: config.kind,
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      apiVersion: config.apiVersion,
      deployment: config.deployment,
      managedBy: "env",
      managedKey: config.managedKey,
      updatedAt: now,
    };
  });

  const defaultManagedKey = resolveEnvDefaultManagedKey(envConfigs);
  if (defaultManagedKey) {
    nextProviders.forEach((provider, index) => {
      nextProviders[index] = {
        ...provider,
        isDefault:
          provider.managedBy === "env" &&
          provider.managedKey === defaultManagedKey,
      };
    });
  }

  if (nextProviders.length === 0) {
    nextProviders.push(createFallbackProvider());
  }

  if (!nextProviders.some((provider) => provider.isDefault)) {
    nextProviders[0] = { ...nextProviders[0]!, isDefault: true };
  }

  return {
    ...state,
    providers: nextProviders,
  };
}

function buildDefaultState(): PersistedState {
  return {
    settings: DEFAULT_SETTINGS,
    providers: buildInitialProviders(),
    conversations: [],
  };
}

async function ensureWorkspaceScaffold(): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  await mkdir(workspaceRoot, { recursive: true });

  const readmePath = path.join(workspaceRoot, "README.md");
  if (!existsSync(readmePath)) {
    await writeFile(
      readmePath,
      "# Neural Labs Workspace\n\nThis directory stores files created inside the Neural Labs desktop.\n",
      "utf-8"
    );
  }
}

export async function ensureDataScaffold(): Promise<void> {
  await mkdir(getDataRoot(), { recursive: true });
  await ensureWorkspaceScaffold();

  const stateFile = getStateFilePath();
  if (!existsSync(stateFile)) {
    await writeFile(
      stateFile,
      JSON.stringify(buildDefaultState(), null, 2),
      "utf-8"
    );
  }
}

export async function readState(): Promise<PersistedState> {
  await ensureDataScaffold();
  const raw = await readFile(getStateFilePath(), "utf-8");
  const parsed = JSON.parse(raw) as PersistedState;
  const normalizedState: PersistedState = {
    ...parsed,
    settings: normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...parsed.settings,
    }),
  };
  if (hasReconciledEnvProviders) {
    return normalizedState;
  }

  const reconciledState = reconcileStateWithEnvProviders(normalizedState);
  hasReconciledEnvProviders = true;
  if (
    JSON.stringify(reconciledState.providers) !==
    JSON.stringify(normalizedState.providers)
  ) {
    await writeState(reconciledState);
  }
  return reconciledState;
}

export async function writeState(state: PersistedState): Promise<void> {
  await ensureDataScaffold();
  await writeFile(getStateFilePath(), JSON.stringify(state, null, 2), "utf-8");
}

export async function readSettingsSnapshot(): Promise<SettingsSnapshot> {
  const state = await readState();
  return {
    desktop: state.settings,
    providers: state.providers,
  };
}

export async function updateDesktopSettings(
  nextSettings: Partial<DesktopSettings>
): Promise<DesktopSettings> {
  const state = await readState();
  state.settings = normalizeSettings({ ...state.settings, ...nextSettings });
  await writeState(state);
  return state.settings;
}

export async function saveProvider(
  draft: ProviderDraft,
  providerId?: string
): Promise<ProviderRecord> {
  const state = await readState();
  const now = new Date().toISOString();
  let savedProvider: ProviderRecord | null = null;

  state.providers = state.providers.map((provider) => {
    if (provider.id !== providerId) {
      return draft.isDefault ? { ...provider, isDefault: false } : provider;
    }

    savedProvider = {
      ...provider,
      ...draft,
      apiVersion: draft.apiVersion?.trim() || undefined,
      deployment: draft.deployment?.trim() || undefined,
      isDefault: draft.isDefault ?? provider.isDefault,
      updatedAt: now,
    };
    return savedProvider;
  });

  if (!savedProvider) {
    savedProvider = {
      id: randomUUID(),
      name: draft.name.trim(),
      kind: draft.kind,
      model: draft.model.trim(),
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      apiVersion: draft.apiVersion?.trim() || undefined,
      deployment: draft.deployment?.trim() || undefined,
      isDefault: Boolean(draft.isDefault),
      createdAt: now,
      updatedAt: now,
    };
    if (savedProvider.isDefault) {
      state.providers = state.providers.map((provider) => ({
        ...provider,
        isDefault: false,
      }));
    }
    state.providers.push(savedProvider);
  }

  if (!state.providers.some((provider) => provider.isDefault)) {
    state.providers[0] = { ...state.providers[0]!, isDefault: true };
    if (savedProvider.id === state.providers[0]!.id) {
      savedProvider = state.providers[0]!;
    }
  }

  await writeState(state);
  return savedProvider;
}

export async function deleteProvider(providerId: string): Promise<void> {
  const state = await readState();
  const before = state.providers.length;
  state.providers = state.providers.filter((provider) => provider.id !== providerId);
  if (state.providers.length === before) {
    throw new Error("Provider not found");
  }
  if (state.providers.length === 0) {
    state.providers.push(createFallbackProvider());
  }
  if (!state.providers.some((provider) => provider.isDefault)) {
    state.providers[0] = { ...state.providers[0]!, isDefault: true };
  }
  await writeState(state);
}

export async function setDefaultProvider(providerId: string): Promise<ProviderRecord> {
  const state = await readState();
  let found: ProviderRecord | null = null;
  state.providers = state.providers.map((provider) => {
    const isDefault = provider.id === providerId;
    const next = { ...provider, isDefault };
    if (isDefault) {
      found = next;
    }
    return next;
  });
  if (!found) {
    throw new Error("Provider not found");
  }
  await writeState(state);
  return found;
}

export async function listConversations(): Promise<ConversationRecord[]> {
  const state = await readState();
  return state.conversations.sort((left, right) =>
    right.summary.updatedAt.localeCompare(left.summary.updatedAt)
  );
}

export async function saveConversation(
  nextConversation: ConversationRecord
): Promise<ConversationRecord> {
  const state = await readState();
  const index = state.conversations.findIndex(
    (conversation) => conversation.summary.id === nextConversation.summary.id
  );
  if (index === -1) {
    state.conversations.push(nextConversation);
  } else {
    state.conversations[index] = nextConversation;
  }
  await writeState(state);
  return nextConversation;
}

export async function getConversation(
  conversationId: string
): Promise<ConversationRecord | null> {
  const state = await readState();
  return (
    state.conversations.find(
      (conversation) => conversation.summary.id === conversationId
    ) ?? null
  );
}

export async function removeConversation(conversationId: string): Promise<void> {
  const state = await readState();
  state.conversations = state.conversations.filter(
    (conversation) => conversation.summary.id !== conversationId
  );
  await writeState(state);
}
