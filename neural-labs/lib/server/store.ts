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
  DesktopSettings,
  ProviderDraft,
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
};

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

function createDefaultProvider(): ProviderRecord {
  const envKind = getValidatedProviderKind(process.env.NEURAL_LABS_PROVIDER_KIND);
  const template = getTemplateByKind(envKind);
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    name: process.env.NEURAL_LABS_PROVIDER_NAME || template.label,
    kind: envKind || template.kind,
    model:
      process.env.NEURAL_LABS_PROVIDER_MODEL || template.modelPlaceholder,
    baseUrl:
      process.env.NEURAL_LABS_PROVIDER_BASE_URL || template.baseUrl,
    apiKey: process.env.NEURAL_LABS_PROVIDER_API_KEY || "",
    apiVersion:
      process.env.NEURAL_LABS_PROVIDER_API_VERSION || template.apiVersion,
    deployment: process.env.NEURAL_LABS_PROVIDER_DEPLOYMENT || undefined,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

function buildDefaultState(): PersistedState {
  return {
    settings: DEFAULT_SETTINGS,
    providers: [createDefaultProvider()],
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
  return JSON.parse(raw) as PersistedState;
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
  state.settings = { ...state.settings, ...nextSettings };
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
    state.providers.push(createDefaultProvider());
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
