"use client";

import { useEffect, useRef, useState } from "react";

import { buildProviderDraft, PROVIDER_TEMPLATES } from "@/lib/shared/providers";
import type {
  ConversationRecord,
  ConversationSummary,
  DesktopBackgroundId,
  DesktopBackgroundPresetId,
  FileEntry,
  ProviderDraft,
  SettingsSnapshot,
  ThemeMode,
} from "@/lib/shared/types";
import {
  Badge,
  Button,
  cn,
  Field,
  Select,
  TextArea,
  TextInput,
} from "@/components/ui/primitives";
import {
  ArrowUpIcon,
  FileIcon,
  FolderIcon,
  ImageIcon,
  MicrophoneIcon,
  PaperclipIcon,
  PlusIcon,
  SettingsIcon,
  SidebarIcon,
  SparkIcon,
  TerminalIcon,
  UploadIcon,
} from "@/components/ui/icons";
export { FileExplorerPanel } from "@/components/desktop/file-explorer-panel";
export { TextEditorPanel } from "@/components/desktop/text-editor-panel";
export { TerminalPanel } from "@/components/desktop/terminal-panel";

export function PreviewPanel({
  entry,
  fileUrl,
  fileText,
}: {
  entry: FileEntry;
  fileUrl: string;
  fileText: string | null;
}) {
  if (entry.mimeType.startsWith("image/")) {
    return (
      <div className="nl-preview-wrap">
        <img className="nl-preview-image" src={fileUrl} alt={entry.name} />
      </div>
    );
  }

  if (entry.mimeType === "application/pdf" || entry.mimeType.startsWith("text/html")) {
    return <iframe className="nl-preview-frame" src={fileUrl} title={entry.name} />;
  }

  return (
    <pre className="nl-preview-text">
      {fileText ?? "Loading preview..."}
    </pre>
  );
}

export function NeuraPanel({
  conversations,
  activeConversation,
  assistantName,
  defaultModel,
  defaultProviderName,
  onCreateConversation,
  onSelectConversation,
  onDeleteConversation,
  onSendMessage,
}: {
  conversations: ConversationSummary[];
  activeConversation: ConversationRecord | null;
  assistantName: string;
  defaultModel: string;
  defaultProviderName: string | null;
  onCreateConversation: () => Promise<void>;
  onSelectConversation: (id: string) => Promise<void>;
  onDeleteConversation: (id: string) => Promise<void>;
  onSendMessage: (content: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const hasBootstrappedConversation = useRef(false);

  useEffect(() => {
    if (
      hasBootstrappedConversation.current ||
      conversations.length > 0 ||
      activeConversation
    ) {
      return;
    }
    hasBootstrappedConversation.current = true;
    if (!conversations.length && !activeConversation) {
      void onCreateConversation();
    }
  }, [activeConversation, conversations.length, onCreateConversation]);

  return (
    <div className="nl-panel">
      <div className="nl-neura-layout">
        {sidebarOpen ? (
        <aside className="nl-sidebar-card nl-neura-sidebar">
          <div className="nl-panel__toolbar nl-panel__toolbar--stacked">
            <div>
              <h3>{assistantName}</h3>
              <p className="nl-muted-copy">
                {defaultModel}
                {defaultProviderName ? ` via ${defaultProviderName}` : ""}
              </p>
            </div>
            <Button onClick={onCreateConversation}>
              <PlusIcon className="nl-inline-icon" />
              New Chat
            </Button>
          </div>
          <div className="nl-list">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={cn(
                  "nl-list-item",
                  activeConversation?.summary.id === conversation.id &&
                    "nl-list-item--selected"
                )}
                onClick={() => onSelectConversation(conversation.id)}
              >
                <SparkIcon className="nl-list-item__icon" />
                <span className="nl-list-item__meta">
                  <strong>{conversation.title}</strong>
                  <span>{conversation.model}</span>
                </span>
              </button>
            ))}
          </div>
          {activeConversation ? (
            <Button
              variant="danger"
              onClick={() => onDeleteConversation(activeConversation.summary.id)}
            >
              Delete Conversation
            </Button>
          ) : null}
        </aside>
        ) : null}
        <section className="nl-chat nl-chat--neura">
          <header className="nl-neura-header">
            <div className="nl-neura-header__title">
              <button
                type="button"
                className="nl-nav-button"
                aria-label="Toggle conversation sidebar"
                onClick={() => setSidebarOpen((current) => !current)}
              >
                <SidebarIcon className="nl-inline-icon" />
              </button>
              <div className="nl-neura-header__meta">
                <strong>{activeConversation?.summary.title ?? assistantName}</strong>
                <span>
                  {defaultModel}
                  {defaultProviderName ? ` via ${defaultProviderName}` : ""}
                </span>
              </div>
            </div>
            <Button onClick={onCreateConversation}>
              <PlusIcon className="nl-inline-icon" />
              New Chat
            </Button>
          </header>
          <div className="nl-chat__messages nl-chat__messages--neura">
            {activeConversation?.messages.length ? (
              activeConversation.messages.map((message) => (
                <article
                  key={message.id}
                  className={cn(
                    "nl-message",
                    message.role === "assistant" && "nl-message--assistant",
                    message.role === "assistant"
                      ? "nl-message--assistant-rich"
                      : "nl-message--user-rich"
                  )}
                >
                  <header>
                    <strong>{message.role === "assistant" ? assistantName : "You"}</strong>
                    <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
                  </header>
                  <p>{message.content}</p>
                </article>
              ))
            ) : (
              <div className="nl-empty-state">
                Create or select a conversation to start using Neura.
              </div>
            )}
          </div>
          <form
            className="nl-chat__composer nl-chat__composer--pill"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!draft.trim() || sending) {
                return;
              }
              setSending(true);
              try {
                await onSendMessage(draft);
                setDraft("");
              } finally {
                setSending(false);
              }
            }}
          >
            <div className="nl-neura-composer__actions">
              <button
                type="button"
                className="nl-nav-button"
                aria-label="Voice input unavailable"
                disabled
              >
                <MicrophoneIcon className="nl-inline-icon" />
              </button>
              <button
                type="button"
                className="nl-nav-button"
                aria-label="Attachments unavailable"
                disabled
              >
                <PaperclipIcon className="nl-inline-icon" />
              </button>
              <button
                type="button"
                className="nl-nav-button"
                aria-label="Image upload unavailable"
                disabled
              >
                <ImageIcon className="nl-inline-icon" />
              </button>
            </div>
            <TextArea
              rows={3}
              value={draft}
              placeholder="Ask Neura for help with your workspace or project."
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="nl-neura-composer__footer">
              <Badge accent="neutral">{defaultModel}</Badge>
              <Button type="submit" disabled={!activeConversation || sending}>
                <ArrowUpIcon className="nl-inline-icon" />
                {sending ? "Sending..." : "Send"}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

export function SettingsPanel({
  snapshot,
  onSaveDesktopSettings,
  customBackgroundUrl,
  onUploadCustomBackground,
  onSelectCustomBackground,
  onDeleteCustomBackground,
  onCreateProvider,
  onUpdateProvider,
  onDeleteProvider,
  onMakeDefault,
  onTestProvider,
}: {
  snapshot: SettingsSnapshot | null;
  onSaveDesktopSettings: (payload: {
    theme?: ThemeMode;
    backgroundId?: DesktopBackgroundId;
    customBackgroundPath?: string | null;
  }) => Promise<void>;
  customBackgroundUrl: string | null;
  onUploadCustomBackground: (file: File) => Promise<void>;
  onSelectCustomBackground: () => Promise<void>;
  onDeleteCustomBackground: () => Promise<void>;
  onCreateProvider: (draft: ProviderDraft) => Promise<void>;
  onUpdateProvider: (providerId: string, draft: ProviderDraft) => Promise<void>;
  onDeleteProvider: (providerId: string) => Promise<void>;
  onMakeDefault: (providerId: string) => Promise<void>;
  onTestProvider: (providerId: string) => Promise<string>;
}) {
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderDraft>(buildProviderDraft("openai"));
  const [templateId, setTemplateId] = useState("openai");
  const [status, setStatus] = useState<string>("");
  const backgroundUploadRef = useRef<HTMLInputElement | null>(null);

  const providers = snapshot?.providers ?? [];

  useEffect(() => {
    if (!providers.length) {
      setSelectedProviderId(null);
      return;
    }
    const selected =
      providers.find((provider) => provider.id === selectedProviderId) ??
      providers.find((provider) => provider.isDefault) ??
      providers[0];
    setSelectedProviderId(selected?.id ?? null);
    if (selected) {
      setDraft({
        name: selected.name,
        kind: selected.kind,
        model: selected.model,
        baseUrl: selected.baseUrl,
        apiKey: selected.apiKey,
        apiVersion: selected.apiVersion,
        deployment: selected.deployment,
        isDefault: selected.isDefault,
      });
    }
  }, [providers, selectedProviderId]);

  return (
    <div className="nl-panel">
      <div className="nl-settings-grid">
        <section className="nl-sidebar-card">
          <div className="nl-panel__toolbar nl-panel__toolbar--stacked">
            <div>
              <h3>Desktop Settings</h3>
              <p className="nl-muted-copy">
                Manage the workspace look and the Neura model providers from one place.
              </p>
            </div>
          </div>

          <Field label="Theme">
            <Select
              value={snapshot?.desktop.theme ?? "dark"}
              onChange={(event) =>
                void onSaveDesktopSettings({
                  theme: event.target.value as ThemeMode,
                })
              }
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </Select>
          </Field>

          <div className="nl-field">
            <span className="nl-field__label">Background</span>
            <div className="nl-background-grid">
              {(
                [
                  ["aurora", "Aurora"],
                  ["graphite", "Graphite"],
                  ["sunrise-grid", "Sunrise Grid"],
                  ["ocean-night", "Ocean Night"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    "nl-background-card",
                    snapshot?.desktop.backgroundId === id &&
                      "nl-background-card--selected",
                    `nl-background-card--${id}`
                  )}
                  onClick={() =>
                    void onSaveDesktopSettings({
                      backgroundId: id as DesktopBackgroundPresetId,
                    })
                  }
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="nl-settings-card">
            <div className="nl-settings-card__header">
              <div>
                <strong>Custom Background</strong>
                <p className="nl-muted-copy">
                  Upload one image and reuse it across the desktop.
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() => backgroundUploadRef.current?.click()}
              >
                <UploadIcon className="nl-inline-icon" />
                Upload
              </Button>
            </div>
            <input
              ref={backgroundUploadRef}
              className="nl-hidden-input"
              type="file"
              accept="image/*"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) {
                  await onUploadCustomBackground(file);
                }
              }}
            />
            {customBackgroundUrl ? (
              <>
                <div className="nl-custom-background-preview">
                  <img src={customBackgroundUrl} alt="Custom desktop background" />
                </div>
                <div className="nl-toolbar-actions">
                  <Button variant="ghost" onClick={onSelectCustomBackground}>
                    Use Custom
                  </Button>
                  <Button variant="danger" onClick={onDeleteCustomBackground}>
                    Delete
                  </Button>
                </div>
              </>
            ) : (
              <div className="nl-empty-state">
                No custom background uploaded yet.
              </div>
            )}
          </div>

          <div className="nl-field">
            <span className="nl-field__label">Configured Providers</span>
            <div className="nl-list">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  className={cn(
                    "nl-list-item",
                    selectedProviderId === provider.id && "nl-list-item--selected"
                  )}
                  onClick={() => {
                    setSelectedProviderId(provider.id);
                    setDraft({
                      name: provider.name,
                      kind: provider.kind,
                      model: provider.model,
                      baseUrl: provider.baseUrl,
                      apiKey: provider.apiKey,
                      apiVersion: provider.apiVersion,
                      deployment: provider.deployment,
                      isDefault: provider.isDefault,
                    });
                  }}
                >
                  <SettingsIcon className="nl-list-item__icon" />
                  <span className="nl-list-item__meta">
                    <strong>{provider.name}</strong>
                    <span>{provider.model}</span>
                  </span>
                  {provider.isDefault ? <Badge accent="success">Default</Badge> : null}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="nl-sidebar-card">
          <div className="nl-panel__toolbar nl-panel__toolbar--stacked">
            <div>
              <h3>Provider Configuration</h3>
              <p className="nl-muted-copy">
                Choose a built-in template, then save it as a Neural Labs provider.
              </p>
            </div>
          </div>

          <Field label="Template">
            <Select
              value={templateId}
              onChange={(event) => {
                setTemplateId(event.target.value);
                setSelectedProviderId(null);
                setDraft(buildProviderDraft(event.target.value));
              }}
            >
              {PROVIDER_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Name">
            <TextInput
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
          </Field>

          <Field label="Provider Kind">
            <Select
              value={draft.kind}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  kind: event.target.value as ProviderDraft["kind"],
                }))
              }
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="openai-compatible">OpenAI-Compatible</option>
              <option value="azure-openai">Azure OpenAI</option>
            </Select>
          </Field>

          <Field label="Base URL">
            <TextInput
              value={draft.baseUrl}
              onChange={(event) =>
                setDraft((current) => ({ ...current, baseUrl: event.target.value }))
              }
            />
          </Field>

          <Field label="Model" hint="Use a model or deployment name appropriate for the selected provider.">
            <TextInput
              value={draft.model}
              onChange={(event) =>
                setDraft((current) => ({ ...current, model: event.target.value }))
              }
            />
          </Field>

          {draft.kind === "azure-openai" ? (
            <>
              <Field label="Deployment Name">
                <TextInput
                  value={draft.deployment ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      deployment: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="API Version">
                <TextInput
                  value={draft.apiVersion ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      apiVersion: event.target.value,
                    }))
                  }
                />
              </Field>
            </>
          ) : null}

          <Field label="API Key">
            <TextInput
              type="password"
              value={draft.apiKey}
              onChange={(event) =>
                setDraft((current) => ({ ...current, apiKey: event.target.value }))
              }
            />
          </Field>

          <label className="nl-inline-checkbox">
            <input
              type="checkbox"
              checked={Boolean(draft.isDefault)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  isDefault: event.target.checked,
                }))
              }
            />
            Use this provider by default in Neura
          </label>

          <div className="nl-toolbar-actions">
            <Button
              onClick={async () => {
                setStatus("Saving provider...");
                if (selectedProviderId) {
                  await onUpdateProvider(selectedProviderId, draft);
                } else {
                  await onCreateProvider(draft);
                }
                setStatus("Provider saved.");
              }}
            >
              {selectedProviderId ? "Update Provider" : "Create Provider"}
            </Button>
            {selectedProviderId ? (
              <>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    setStatus("Testing connection...");
                    setStatus(await onTestProvider(selectedProviderId));
                  }}
                >
                  Test
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await onMakeDefault(selectedProviderId);
                    setStatus("Default provider updated.");
                  }}
                >
                  Make Default
                </Button>
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (window.confirm("Delete this provider?")) {
                      await onDeleteProvider(selectedProviderId);
                      setSelectedProviderId(null);
                      setDraft(buildProviderDraft(templateId));
                      setStatus("Provider deleted.");
                    }
                  }}
                >
                  Delete
                </Button>
              </>
            ) : null}
          </div>

          {status ? <div className="nl-status-note">{status}</div> : null}
        </section>
      </div>
    </div>
  );
}

export const DOCK_APPS = [
  { kind: "files", label: "Files", icon: FolderIcon, accent: "#62a6ff" },
  { kind: "editor", label: "Editor", icon: FileIcon, accent: "#ff9b5d" },
  { kind: "terminal", label: "Terminal", icon: TerminalIcon, accent: "#8ef7b0" },
  { kind: "neura", label: "Neura", icon: SparkIcon, accent: "#f7ce68" },
  { kind: "settings", label: "Desktop Settings", icon: SettingsIcon, accent: "#e0d7ff" },
] as const;
