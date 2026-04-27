"use client";

import { useEffect, useRef, useState } from "react";

import {
  createInviteRequest,
  listInvitesRequest,
  logout,
  revokeInviteRequest,
} from "@/lib/client/api";
import { buildProviderDraft, PROVIDER_TEMPLATES } from "@/lib/shared/providers";
import type {
  AuthInviteRecord,
  AuthRole,
  AuthViewer,
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
  viewer,
  avatarUrl,
  snapshot,
  onSaveDesktopSettings,
  customBackgroundUrl,
  onUploadCustomBackground,
  onSelectCustomBackground,
  onDeleteCustomBackground,
  onUploadAvatar,
  onRemoveAvatar,
  onCreateProvider,
  onUpdateProvider,
  onDeleteProvider,
  onMakeDefault,
  onTestProvider,
}: {
  viewer: AuthViewer;
  avatarUrl: string | null;
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
  onUploadAvatar: (file: File) => Promise<void>;
  onRemoveAvatar: () => Promise<void>;
  onCreateProvider: (draft: ProviderDraft) => Promise<void>;
  onUpdateProvider: (providerId: string, draft: ProviderDraft) => Promise<void>;
  onDeleteProvider: (providerId: string) => Promise<void>;
  onMakeDefault: (providerId: string) => Promise<void>;
  onTestProvider: (providerId: string) => Promise<string>;
}) {
  const [activeSection, setActiveSection] = useState<
    "appearance" | "providers" | "account" | "admin"
  >("appearance");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderDraft>(buildProviderDraft("openai"));
  const [templateId, setTemplateId] = useState("openai");
  const [status, setStatus] = useState<string>("");
  const [invites, setInvites] = useState<AuthInviteRecord[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AuthRole>("user");
  const [inviteStatusText, setInviteStatusText] = useState("");
  const [latestInviteUrl, setLatestInviteUrl] = useState("");
  const [isLoadingInvites, setIsLoadingInvites] = useState(false);
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);
  const [hasLoadedInvites, setHasLoadedInvites] = useState(false);
  const backgroundUploadRef = useRef<HTMLInputElement | null>(null);
  const avatarUploadRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    if (viewer.role !== "admin" || activeSection !== "admin" || hasLoadedInvites) {
      return;
    }

    setIsLoadingInvites(true);
    setInviteStatusText("");
    void listInvitesRequest()
      .then((result) => {
        setInvites(result.invites);
        setHasLoadedInvites(true);
      })
      .catch((error) => {
        setInviteStatusText(
          error instanceof Error ? error.message : "Unable to load invites"
        );
      })
      .finally(() => setIsLoadingInvites(false));
  }, [activeSection, hasLoadedInvites, viewer.role]);

  const settingsSections = [
    {
      id: "appearance" as const,
      label: "Appearance",
      description: "Theme and desktop background",
      icon: ImageIcon,
    },
    {
      id: "providers" as const,
      label: "Providers",
      description: "Model connections and defaults",
      icon: SparkIcon,
    },
    {
      id: "account" as const,
      label: "Account",
      description: "Identity and session controls",
      icon: FileIcon,
    },
    ...(viewer.role === "admin"
      ? [
          {
            id: "admin" as const,
            label: "Admin",
            description: "Invite management",
            icon: SettingsIcon,
          },
        ]
      : []),
  ];

  function inviteStateLabel(invite: AuthInviteRecord): string {
    if (invite.revokedAt) {
      return "Revoked";
    }
    if (invite.acceptedAt) {
      return "Accepted";
    }
    if (new Date(invite.expiresAt).getTime() <= Date.now()) {
      return "Expired";
    }
    return "Active";
  }

  async function handleLogout() {
    await logout();
    window.location.href = "/login";
  }

  async function handleCreateInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmittingInvite(true);
    setInviteStatusText("");
    setLatestInviteUrl("");

    try {
      const created = await createInviteRequest({
        email: inviteEmail,
        role: inviteRole,
      });
      setInvites((current) => [
        {
          id: created.id,
          email: created.email,
          role: created.role,
          createdAt: created.createdAt,
          expiresAt: created.expiresAt,
          acceptedAt: created.acceptedAt,
          revokedAt: created.revokedAt,
        },
        ...current.filter((invite) => invite.email !== created.email),
      ]);
      setLatestInviteUrl(created.invitationUrl);
      setInviteEmail("");
      setInviteRole("user");
      setHasLoadedInvites(true);
    } catch (error) {
      setInviteStatusText(
        error instanceof Error ? error.message : "Unable to create invite"
      );
    } finally {
      setIsSubmittingInvite(false);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    setRevokingInviteId(inviteId);
    setInviteStatusText("");
    try {
      await revokeInviteRequest(inviteId);
      setInvites((current) =>
        current.map((invite) =>
          invite.id === inviteId
            ? { ...invite, revokedAt: new Date().toISOString() }
            : invite
        )
      );
    } catch (error) {
      setInviteStatusText(
        error instanceof Error ? error.message : "Unable to revoke invite"
      );
    } finally {
      setRevokingInviteId(null);
    }
  }

  return (
    <div className="nl-panel">
      <div className="nl-settings-shell">
        <aside className="nl-sidebar-card nl-settings-nav">
          <div className="nl-panel__toolbar nl-panel__toolbar--stacked">
            <div>
              <h3>Desktop Settings</h3>
              <p className="nl-muted-copy">
                Workspace appearance, model providers, account, and admin tools.
              </p>
            </div>
          </div>

          <div className="nl-list">
            {settingsSections.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={cn(
                    "nl-list-item",
                    activeSection === section.id && "nl-list-item--selected"
                  )}
                  onClick={() => setActiveSection(section.id)}
                >
                  <Icon className="nl-list-item__icon" />
                  <span className="nl-list-item__meta">
                    <strong>{section.label}</strong>
                    <span>{section.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="nl-sidebar-card nl-settings-main">
          {activeSection === "appearance" ? (
            <div className="nl-settings-section-stack">
              <div className="nl-panel__toolbar nl-panel__toolbar--stacked">
                <div>
                  <h3>Appearance</h3>
                  <p className="nl-muted-copy">
                    Adjust the desktop theme and choose the default background.
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
                <span className="nl-field__label">Background Presets</span>
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
                      Upload one image and keep it available across the desktop.
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
            </div>
          ) : null}

          {activeSection === "providers" ? (
            <div className="nl-settings-section-stack">
              <div className="nl-panel__toolbar nl-panel__toolbar--stacked">
                <div>
                  <h3>Providers</h3>
                  <p className="nl-muted-copy">
                    Configure the model endpoints Neural Labs can use and choose the default.
                  </p>
                </div>
              </div>

              <div className="nl-settings-provider-layout">
                <div className="nl-settings-provider-sidebar">
                  <div className="nl-settings-card">
                    <div className="nl-settings-card__header">
                      <div>
                        <strong>Configured Providers</strong>
                        <p className="nl-muted-copy">
                          Select one to edit or create a new provider.
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setSelectedProviderId(null);
                          setTemplateId("openai");
                          setDraft(buildProviderDraft("openai"));
                          setStatus("");
                        }}
                      >
                        <PlusIcon className="nl-inline-icon" />
                        New
                      </Button>
                    </div>
                    <div className="nl-list">
                      {providers.length ? (
                        providers.map((provider) => (
                          <button
                            key={provider.id}
                            type="button"
                            className={cn(
                              "nl-list-item",
                              selectedProviderId === provider.id &&
                                "nl-list-item--selected"
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
                              setStatus("");
                            }}
                          >
                            <SettingsIcon className="nl-list-item__icon" />
                            <span className="nl-list-item__meta">
                              <strong>{provider.name}</strong>
                              <span>{provider.model}</span>
                            </span>
                            {provider.isDefault ? (
                              <Badge accent="success">Default</Badge>
                            ) : null}
                          </button>
                        ))
                      ) : (
                        <div className="nl-empty-state">
                          No providers configured yet. Start with a template on the right.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="nl-settings-provider-detail">
                  <div className="nl-settings-card">
                    <div className="nl-settings-card__header">
                      <div>
                        <strong>
                          {selectedProviderId ? "Edit Provider" : "New Provider"}
                        </strong>
                        <p className="nl-muted-copy">
                          Choose a template, then save the provider for Neura.
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
                          setStatus("");
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
                          setDraft((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
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
                          setDraft((current) => ({
                            ...current,
                            baseUrl: event.target.value,
                          }))
                        }
                      />
                    </Field>

                    <Field
                      label="Model"
                      hint="Use a model or deployment name appropriate for the selected provider."
                    >
                      <TextInput
                        value={draft.model}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            model: event.target.value,
                          }))
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
                          setDraft((current) => ({
                            ...current,
                            apiKey: event.target.value,
                          }))
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
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {activeSection === "account" ? (
            <div className="nl-settings-section-stack">
              <div className="nl-panel__toolbar nl-panel__toolbar--stacked">
                <div>
                  <h3>Account</h3>
                  <p className="nl-muted-copy">
                    Review the signed-in account and manage the current session.
                  </p>
                </div>
              </div>

              <div className="nl-settings-meta-grid">
                <div className="nl-settings-meta-item">
                  <span>Email</span>
                  <strong>{viewer.email}</strong>
                </div>
                <div className="nl-settings-meta-item">
                  <span>Role</span>
                  <strong>{viewer.role}</strong>
                </div>
                <div className="nl-settings-meta-item">
                  <span>Account Created</span>
                  <strong>{new Date(viewer.createdAt).toLocaleString()}</strong>
                </div>
              </div>

              <div className="nl-settings-card">
                <div className="nl-settings-card__header">
                  <div>
                    <strong>Avatar</strong>
                    <p className="nl-muted-copy">
                      Upload a profile image for the desktop topbar menu.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => avatarUploadRef.current?.click()}
                  >
                    <UploadIcon className="nl-inline-icon" />
                    Upload
                  </Button>
                </div>
                <input
                  ref={avatarUploadRef}
                  className="nl-hidden-input"
                  type="file"
                  accept="image/*"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) {
                      await onUploadAvatar(file);
                    }
                  }}
                />
                <div className="nl-settings-avatar-card">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={viewer.email}
                      className="nl-settings-avatar-card__image"
                    />
                  ) : (
                    <div className="nl-settings-avatar-card__fallback">
                      {viewer.email.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="nl-settings-avatar-card__copy">
                    <strong>{avatarUrl ? "Current avatar" : "No avatar uploaded"}</strong>
                    <span>
                      {avatarUrl
                        ? "This image is shown in the desktop avatar menu."
                        : "Upload an image to personalize the desktop topbar."}
                    </span>
                  </div>
                </div>
                {avatarUrl ? (
                  <div className="nl-toolbar-actions">
                    <Button variant="danger" onClick={onRemoveAvatar}>
                      Remove Avatar
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="nl-settings-card">
                <div className="nl-settings-card__header">
                  <div>
                    <strong>Session</strong>
                    <p className="nl-muted-copy">
                      This account maps to the persistent Neural Labs workspace and container.
                    </p>
                  </div>
                </div>
                <div className="nl-toolbar-actions">
                  <Button variant="ghost" onClick={() => void handleLogout()}>
                    Sign out
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {activeSection === "admin" && viewer.role === "admin" ? (
            <div className="nl-settings-section-stack">
              <div className="nl-panel__toolbar nl-panel__toolbar--stacked">
                <div>
                  <h3>Admin</h3>
                  <p className="nl-muted-copy">
                    Create invites and manage who can access Neural Labs.
                  </p>
                </div>
              </div>

              <div className="nl-settings-card">
                <form className="nl-settings-inline-form" onSubmit={handleCreateInvite}>
                  <Field label="Invite Email">
                    <TextInput
                      type="email"
                      autoComplete="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="teammate@example.com"
                      required
                    />
                  </Field>

                  <Field label="Role">
                    <Select
                      value={inviteRole}
                      onChange={(event) =>
                        setInviteRole(event.target.value as AuthRole)
                      }
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </Select>
                  </Field>

                  <div className="nl-settings-inline-form__actions">
                    <Button type="submit" disabled={isSubmittingInvite}>
                      {isSubmittingInvite ? "Creating..." : "Create Invite"}
                    </Button>
                  </div>
                </form>

                {latestInviteUrl ? (
                  <div className="nl-auth-callout">
                    <strong>Invite Link</strong>
                    <p>{latestInviteUrl}</p>
                    <Button
                      variant="ghost"
                      onClick={() => void navigator.clipboard.writeText(latestInviteUrl)}
                    >
                      Copy Link
                    </Button>
                  </div>
                ) : null}

                {inviteStatusText ? (
                  <div className="nl-status-note">{inviteStatusText}</div>
                ) : null}

                <div className="nl-auth-table">
                  <div className="nl-auth-table__header">
                    <span>Email</span>
                    <span>Role</span>
                    <span>Status</span>
                    <span>Expires</span>
                    <span />
                  </div>

                  {isLoadingInvites ? (
                    <div className="nl-auth-table__empty">Loading invites...</div>
                  ) : invites.length === 0 ? (
                    <div className="nl-auth-table__empty">No invites created yet.</div>
                  ) : (
                    invites.map((invite) => (
                      <div key={invite.id} className="nl-auth-table__row">
                        <span>{invite.email}</span>
                        <span>{invite.role}</span>
                        <span>{inviteStateLabel(invite)}</span>
                        <span>{new Date(invite.expiresAt).toLocaleString()}</span>
                        <span>
                          {!invite.acceptedAt && !invite.revokedAt ? (
                            <Button
                              variant="ghost"
                              disabled={revokingInviteId === invite.id}
                              onClick={() => void handleRevokeInvite(invite.id)}
                            >
                              {revokingInviteId === invite.id
                                ? "Revoking..."
                                : "Revoke"}
                            </Button>
                          ) : null}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export const DOCK_APPS = [
  { kind: "files", label: "Files", icon: FolderIcon, accent: "#62a6ff" },
  { kind: "editor", label: "Editor", icon: FileIcon, accent: "#ff9b5d" },
  { kind: "terminal", label: "Terminal", icon: TerminalIcon, accent: "#8ef7b0" },
  { kind: "vscode", label: "VS Code", iconSrc: "/apps/vscode.png", accent: "#2d9bf0" },
  { kind: "neura", label: "Neura", icon: SparkIcon, accent: "#f7ce68" },
  { kind: "settings", label: "Desktop Settings", icon: SettingsIcon, accent: "#e0d7ff" },
] as const;
