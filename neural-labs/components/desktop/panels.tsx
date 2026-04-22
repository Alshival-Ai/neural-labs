"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { buildProviderDraft, PROVIDER_TEMPLATES } from "@/lib/shared/providers";
import type {
  ConversationRecord,
  ConversationSummary,
  DesktopBackgroundId,
  DirectoryListing,
  FileEntry,
  ProviderDraft,
  ProviderRecord,
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
  FileIcon,
  FolderIcon,
  PlusIcon,
  RefreshIcon,
  SettingsIcon,
  SparkIcon,
  TerminalIcon,
  UploadIcon,
} from "@/components/ui/icons";

export function FileExplorerPanel({
  listing,
  onNavigate,
  onOpenEntry,
  onRefresh,
  onCreateDirectory,
  onUpload,
  onRename,
  onMove,
  onDelete,
}: {
  listing: DirectoryListing | null;
  onNavigate: (path: string) => void;
  onOpenEntry: (entry: FileEntry) => void;
  onRefresh: () => void;
  onCreateDirectory: (name: string) => Promise<void>;
  onUpload: (files: FileList) => Promise<void>;
  onRename: (entry: FileEntry, name: string) => Promise<void>;
  onMove: (entry: FileEntry, destination: string) => Promise<void>;
  onDelete: (entry: FileEntry) => Promise<void>;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!listing?.entries.some((entry) => entry.path === selectedPath)) {
      setSelectedPath(null);
    }
  }, [listing, selectedPath]);

  const selectedEntry =
    listing?.entries.find((entry) => entry.path === selectedPath) ?? null;

  const breadcrumbs = useMemo(() => {
    const path = listing?.path ?? "";
    if (!path) {
      return [{ label: "workspace", value: "" }];
    }
    const segments = path.split("/");
    return [{ label: "workspace", value: "" }].concat(
      segments.map((segment, index) => ({
        label: segment,
        value: segments.slice(0, index + 1).join("/"),
      }))
    );
  }, [listing?.path]);

  return (
    <div className="nl-panel">
      <div className="nl-panel__toolbar">
        <div className="nl-breadcrumbs">
          {breadcrumbs.map((crumb) => (
            <button
              key={crumb.value || "root"}
              type="button"
              className="nl-breadcrumb"
              onClick={() => onNavigate(crumb.value)}
            >
              {crumb.label}
            </button>
          ))}
        </div>
        <div className="nl-toolbar-actions">
          <Button
            variant="ghost"
            onClick={async () => {
              const name = window.prompt("New folder name");
              if (name) {
                await onCreateDirectory(name);
              }
            }}
          >
            <PlusIcon className="nl-inline-icon" />
            Folder
          </Button>
          <Button
            variant="ghost"
            onClick={() => uploadInputRef.current?.click()}
          >
            <UploadIcon className="nl-inline-icon" />
            Upload
          </Button>
          <Button variant="ghost" onClick={onRefresh}>
            <RefreshIcon className="nl-inline-icon" />
            Refresh
          </Button>
        </div>
      </div>

      <input
        ref={uploadInputRef}
        className="nl-hidden-input"
        type="file"
        multiple
        onChange={async (event) => {
          const files = event.target.files;
          event.target.value = "";
          if (files?.length) {
            await onUpload(files);
          }
        }}
      />

      <div className="nl-split">
        <div className="nl-list">
          {listing?.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={cn(
                "nl-list-item",
                selectedPath === entry.path && "nl-list-item--selected"
              )}
              onClick={() => setSelectedPath(entry.path)}
              onDoubleClick={() => onOpenEntry(entry)}
            >
              {entry.isDirectory ? (
                <FolderIcon className="nl-list-item__icon nl-list-item__icon--folder" />
              ) : (
                <FileIcon className="nl-list-item__icon" />
              )}
              <span className="nl-list-item__meta">
                <strong>{entry.name}</strong>
                <span>{entry.isDirectory ? "Folder" : entry.mimeType}</span>
              </span>
            </button>
          ))}
          {!listing?.entries.length ? (
            <div className="nl-empty-state">This folder is empty.</div>
          ) : null}
        </div>

        <aside className="nl-sidebar-card">
          <h3>Selection</h3>
          {selectedEntry ? (
            <>
              <dl className="nl-meta-grid">
                <div>
                  <dt>Name</dt>
                  <dd>{selectedEntry.name}</dd>
                </div>
                <div>
                  <dt>Path</dt>
                  <dd>{selectedEntry.path || "/"}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{selectedEntry.isDirectory ? "Directory" : selectedEntry.mimeType}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{selectedEntry.isDirectory ? "-" : `${selectedEntry.size} bytes`}</dd>
                </div>
              </dl>
              <div className="nl-stack-sm">
                <Button onClick={() => onOpenEntry(selectedEntry)}>
                  Open
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    const name = window.prompt("Rename to", selectedEntry.name);
                    if (name && name !== selectedEntry.name) {
                      await onRename(selectedEntry, name);
                    }
                  }}
                >
                  Rename
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    const destination = window.prompt(
                      "Move to folder",
                      listing?.path ?? ""
                    );
                    if (destination !== null) {
                      await onMove(selectedEntry, destination);
                    }
                  }}
                >
                  Move
                </Button>
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (
                      window.confirm(
                        `Delete ${selectedEntry.name}? This cannot be undone.`
                      )
                    ) {
                      await onDelete(selectedEntry);
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            </>
          ) : (
            <p className="nl-muted-copy">
              Pick a file or folder to inspect it here.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

export function TextEditorPanel({
  path,
  content,
  dirty,
  loading,
  error,
  onChange,
  onSave,
  onSaveAs,
}: {
  path: string | null;
  content: string;
  dirty: boolean;
  loading: boolean;
  error: string | null;
  onChange: (content: string) => void;
  onSave: () => Promise<void>;
  onSaveAs: (path: string) => Promise<void>;
}) {
  return (
    <div className="nl-panel nl-panel--editor">
      <div className="nl-panel__toolbar">
        <div>
          <strong>{path ?? "Scratch Pad"}</strong>
          <div className="nl-toolbar-subcopy">
            {dirty ? "Unsaved changes" : "Saved"}
          </div>
        </div>
        <div className="nl-toolbar-actions">
          <Button
            variant="ghost"
            onClick={async () => {
              const nextPath = window.prompt(
                "Save as",
                path || `notes/${new Date().toISOString().slice(0, 10)}.md`
              );
              if (nextPath) {
                await onSaveAs(nextPath);
              }
            }}
          >
            Save As
          </Button>
          <Button onClick={onSave} disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
      {error ? <div className="nl-error-banner">{error}</div> : null}
      <TextArea
        className="nl-editor"
        spellCheck={false}
        value={content}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function TerminalPanel({
  sessionId,
  onCloseSession,
}: {
  sessionId: string;
  onCloseSession: () => Promise<void>;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [alive, setAlive] = useState(true);
  const outputRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const eventSource = new EventSource(
      `/api/neural-labs/terminal/sessions/${sessionId}/stream`
    );

    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as {
        type: "output" | "exit";
        text: string;
      };
      setLines((current) => [...current, payload.text]);
      if (payload.type === "exit") {
        setAlive(false);
      }
    };

    eventSource.onerror = () => {
      setAlive(false);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [sessionId]);

  useEffect(() => {
    outputRef.current?.scrollTo({
      top: outputRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [lines]);

  return (
    <div className="nl-panel nl-panel--terminal">
      <div className="nl-panel__toolbar">
        <div>
          <strong>Session {sessionId.slice(0, 8)}</strong>
          <div className="nl-toolbar-subcopy">
            {alive ? "Interactive shell ready" : "Process exited"}
          </div>
        </div>
        <Button variant="ghost" onClick={onCloseSession}>
          End Session
        </Button>
      </div>
      <div ref={outputRef} className="nl-terminal-output">
        {lines.length ? lines.join("") : "Starting shell...\n"}
      </div>
      <form
        className="nl-terminal-input-row"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!draft.trim()) {
            return;
          }
          const command = draft;
          setDraft("");
          await fetch(`/api/neural-labs/terminal/sessions/${sessionId}/input`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: `${command}\n` }),
          });
        }}
      >
        <TextInput
          value={draft}
          placeholder="Enter a shell command"
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" disabled={!alive}>
          Run
        </Button>
      </form>
    </div>
  );
}

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

  return (
    <div className="nl-panel">
      <div className="nl-split">
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
        <section className="nl-chat">
          <div className="nl-chat__messages">
            {activeConversation?.messages.length ? (
              activeConversation.messages.map((message) => (
                <article
                  key={message.id}
                  className={cn(
                    "nl-message",
                    message.role === "assistant" && "nl-message--assistant"
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
            className="nl-chat__composer"
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
            <TextArea
              rows={5}
              value={draft}
              placeholder="Ask Neura for help with your workspace or project."
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="nl-toolbar-actions">
              <Badge accent="neutral">{defaultModel}</Badge>
              <Button type="submit" disabled={!activeConversation || sending}>
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
  }) => Promise<void>;
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
                      backgroundId: id,
                    })
                  }
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>
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
