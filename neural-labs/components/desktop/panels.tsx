"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  createPasswordResetRequest,
  createInviteRequest,
  createUserRequest,
  deleteUserRequest,
  listPasswordResetsRequest,
  listInvitesRequest,
  listUsersRequest,
  logout,
  revokePasswordResetRequest,
  revokeInviteRequest,
  revokeUserSessionsRequest,
  setUserPasswordRequest,
  updateUserRequest,
} from "@/lib/client/api";
import { buildProviderDraft, PROVIDER_TEMPLATES } from "@/lib/shared/providers";
import type {
  AuthAdminUserRecord,
  AuthInviteRecord,
  AuthPasswordResetRecord,
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
  TrashIcon,
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

function formatConversationTime(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "Recent";
  }

  const now = new Date();
  const isSameDay = timestamp.toDateString() === now.toDateString();
  if (isSameDay) {
    return timestamp.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return timestamp.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
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

  const activeConversationId = activeConversation?.summary.id ?? null;
  const providerLabel = defaultProviderName
    ? `${defaultModel} via ${defaultProviderName}`
    : defaultModel;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
  }

  return (
    <div className="nl-panel nl-neura-app">
      <div className={cn("nl-neura-layout", !sidebarOpen && "nl-neura-layout--collapsed")}>
        {sidebarOpen ? (
          <aside className="nl-neura-sidebar" aria-label="Conversation history">
            <div className="nl-neura-sidebar__top">
              <div className="nl-neura-brand">
                <span className="nl-neura-brand__mark">
                  <SparkIcon className="nl-inline-icon" />
                </span>
                <span>
                  <strong>{assistantName}</strong>
                  <span>{providerLabel}</span>
                </span>
              </div>
              <button
                type="button"
                className="nl-neura-new-chat"
                onClick={onCreateConversation}
              >
                <PlusIcon className="nl-inline-icon" />
                New Chat
              </button>
            </div>

            <div className="nl-neura-history">
              <div className="nl-neura-history__label">
                <span>Recent</span>
                <span>{conversations.length}</span>
              </div>
              {conversations.length ? (
                conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    className={cn(
                      "nl-neura-history__item",
                      activeConversationId === conversation.id &&
                        "nl-neura-history__item--active"
                    )}
                    onClick={() => onSelectConversation(conversation.id)}
                  >
                    <span className="nl-neura-history__item-title">
                      {conversation.title}
                    </span>
                    <span className="nl-neura-history__item-meta">
                      <span>{conversation.model}</span>
                      <span>{formatConversationTime(conversation.updatedAt)}</span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="nl-neura-history__empty">
                  Start a chat to build history.
                </div>
              )}
            </div>

            {activeConversationId ? (
              <button
                type="button"
                className="nl-neura-delete-chat"
                onClick={() => onDeleteConversation(activeConversationId)}
              >
                <TrashIcon className="nl-inline-icon" />
                Delete current
              </button>
            ) : null}
          </aside>
        ) : null}

        <section className="nl-chat nl-chat--neura">
          <header className="nl-neura-header">
            <div className="nl-neura-header__title">
              <button
                type="button"
                className="nl-neura-icon-button"
                aria-label="Toggle conversation history"
                onClick={() => setSidebarOpen((current) => !current)}
              >
                <SidebarIcon className="nl-inline-icon" />
              </button>
              <div className="nl-neura-header__meta">
                <strong>{activeConversation?.summary.title ?? assistantName}</strong>
                <span>{providerLabel}</span>
              </div>
            </div>
            <button
              type="button"
              className="nl-neura-header__new-chat"
              onClick={onCreateConversation}
            >
              <PlusIcon className="nl-inline-icon" />
              New Chat
            </button>
          </header>

          <div className="nl-chat__messages nl-chat__messages--neura">
            {activeConversation?.messages.length ? (
              activeConversation.messages.map((message) => {
                const isAssistant = message.role === "assistant";
                return (
                  <article
                    key={message.id}
                    className={cn(
                      "nl-message",
                      isAssistant ? "nl-message--assistant" : "nl-message--user-rich"
                    )}
                  >
                    <header>
                      <strong>{isAssistant ? assistantName : "You"}</strong>
                      <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
                    </header>
                    <p>{message.content}</p>
                  </article>
                );
              })
            ) : (
              <div className="nl-neura-empty-state">
                <span className="nl-neura-empty-state__mark">
                  <SparkIcon className="nl-inline-icon" />
                </span>
                <strong>{activeConversation ? "New conversation" : "No conversation selected"}</strong>
                <span>Ask Neura about your workspace, files, code, or project context.</span>
              </div>
            )}
          </div>

          <form className="nl-chat__composer nl-chat__composer--pill" onSubmit={handleSubmit}>
            <div className="nl-neura-composer__tools">
              <button
                type="button"
                className="nl-neura-tool-button"
                aria-label="Voice input unavailable"
                disabled
              >
                <MicrophoneIcon className="nl-inline-icon" />
              </button>
              <button
                type="button"
                className="nl-neura-tool-button"
                aria-label="Attachments unavailable"
                disabled
              >
                <PaperclipIcon className="nl-inline-icon" />
              </button>
              <button
                type="button"
                className="nl-neura-tool-button"
                aria-label="Image upload unavailable"
                disabled
              >
                <ImageIcon className="nl-inline-icon" />
              </button>
            </div>
            <TextArea
              rows={1}
              value={draft}
              placeholder="Ask Neura anything..."
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="nl-neura-composer__meta">
              <Badge accent="neutral">{defaultModel}</Badge>
              <button
                type="submit"
                className="nl-neura-send-button"
                disabled={!activeConversation || sending || !draft.trim()}
              >
                <ArrowUpIcon className="nl-inline-icon" />
                <span>{sending ? "Sending" : "Send"}</span>
              </button>
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
    customBackgroundVersion?: string | null;
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
  const [users, setUsers] = useState<AuthAdminUserRecord[]>([]);
  const [resets, setResets] = useState<AuthPasswordResetRecord[]>([]);
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRole, setUserRole] = useState<AuthRole>("user");
  const [shouldGeneratePassword, setShouldGeneratePassword] = useState(true);
  const [adminStatusText, setAdminStatusText] = useState("");
  const [latestTemporaryPassword, setLatestTemporaryPassword] = useState("");
  const [latestResetUrl, setLatestResetUrl] = useState("");
  const [invites, setInvites] = useState<AuthInviteRecord[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AuthRole>("user");
  const [inviteStatusText, setInviteStatusText] = useState("");
  const [latestInviteUrl, setLatestInviteUrl] = useState("");
  const [isLoadingInvites, setIsLoadingInvites] = useState(false);
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false);
  const [isSubmittingUser, setIsSubmittingUser] = useState(false);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);
  const [workingUserId, setWorkingUserId] = useState<string | null>(null);
  const [revokingResetId, setRevokingResetId] = useState<string | null>(null);
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
    void Promise.all([
      listUsersRequest(),
      listInvitesRequest(),
      listPasswordResetsRequest(),
    ])
      .then(([userResult, inviteResult, resetResult]) => {
        setUsers(userResult.users);
        setInvites(inviteResult.invites);
        setResets(resetResult.resets);
        setHasLoadedInvites(true);
      })
      .catch((error) => {
        setInviteStatusText(
          error instanceof Error ? error.message : "Unable to load admin data"
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
            description: "Users and recovery",
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

  function resetStateLabel(reset: AuthPasswordResetRecord): string {
    if (reset.revokedAt) {
      return "Revoked";
    }
    if (reset.usedAt) {
      return "Used";
    }
    if (new Date(reset.expiresAt).getTime() <= Date.now()) {
      return "Expired";
    }
    return "Active";
  }

  async function refreshAdminData() {
    const [userResult, inviteResult, resetResult] = await Promise.all([
      listUsersRequest(),
      listInvitesRequest(),
      listPasswordResetsRequest(),
    ]);
    setUsers(userResult.users);
    setInvites(inviteResult.invites);
    setResets(resetResult.resets);
    setHasLoadedInvites(true);
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

  async function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmittingUser(true);
    setAdminStatusText("");
    setLatestTemporaryPassword("");

    try {
      const result = await createUserRequest({
        email: userEmail,
        role: userRole,
        password: shouldGeneratePassword ? undefined : userPassword,
        generatePassword: shouldGeneratePassword,
      });
      setUsers((current) => [result.user, ...current]);
      setUserEmail("");
      setUserPassword("");
      setUserRole("user");
      setShouldGeneratePassword(true);
      if (result.temporaryPassword) {
        setLatestTemporaryPassword(result.temporaryPassword);
      }
      setAdminStatusText("User created.");
    } catch (error) {
      setAdminStatusText(error instanceof Error ? error.message : "Unable to create user");
    } finally {
      setIsSubmittingUser(false);
    }
  }

  async function handleUpdateUser(
    userId: string,
    payload: { role?: AuthRole; disabled?: boolean }
  ) {
    setWorkingUserId(userId);
    setAdminStatusText("");
    try {
      const result = await updateUserRequest(userId, payload);
      setUsers((current) =>
        current.map((entry) => (entry.id === userId ? result.user : entry))
      );
      setAdminStatusText("User updated.");
    } catch (error) {
      setAdminStatusText(error instanceof Error ? error.message : "Unable to update user");
    } finally {
      setWorkingUserId(null);
    }
  }

  async function handleRevokeSessions(userId: string) {
    setWorkingUserId(userId);
    setAdminStatusText("");
    try {
      await revokeUserSessionsRequest(userId);
      setUsers((current) =>
        current.map((entry) =>
          entry.id === userId ? { ...entry, activeSessionCount: 0 } : entry
        )
      );
      setAdminStatusText("Sessions revoked.");
    } catch (error) {
      setAdminStatusText(error instanceof Error ? error.message : "Unable to revoke sessions");
    } finally {
      setWorkingUserId(null);
    }
  }

  async function handleCreatePasswordReset(userId: string) {
    setWorkingUserId(userId);
    setAdminStatusText("");
    setLatestResetUrl("");
    try {
      const reset = await createPasswordResetRequest(userId);
      setResets((current) => [
        {
          id: reset.id,
          userId: reset.userId,
          email: reset.email,
          createdAt: reset.createdAt,
          expiresAt: reset.expiresAt,
          usedAt: reset.usedAt,
          revokedAt: reset.revokedAt,
        },
        ...current.filter((entry) => entry.userId !== reset.userId || entry.usedAt),
      ]);
      setLatestResetUrl(reset.resetUrl);
      setAdminStatusText("Password reset link created.");
    } catch (error) {
      setAdminStatusText(error instanceof Error ? error.message : "Unable to create reset link");
    } finally {
      setWorkingUserId(null);
    }
  }

  async function handleGenerateTemporaryPassword(userId: string) {
    setWorkingUserId(userId);
    setAdminStatusText("");
    setLatestTemporaryPassword("");
    try {
      const result = await setUserPasswordRequest(userId, { generatePassword: true });
      setLatestTemporaryPassword(result.temporaryPassword ?? "");
      setUsers((current) =>
        current.map((entry) =>
          entry.id === userId ? { ...entry, activeSessionCount: 0 } : entry
        )
      );
      setAdminStatusText("Temporary password generated.");
    } catch (error) {
      setAdminStatusText(
        error instanceof Error ? error.message : "Unable to generate temporary password"
      );
    } finally {
      setWorkingUserId(null);
    }
  }

  async function handleDeleteUser(user: AuthAdminUserRecord, deleteWorkspace: boolean) {
    const confirmation = deleteWorkspace
      ? window.prompt(`Type DELETE WORKSPACE to delete ${user.email} and remove workspace data.`)
      : window.prompt(`Type DELETE to delete ${user.email}. Workspace data will be preserved.`);
    if (confirmation !== (deleteWorkspace ? "DELETE WORKSPACE" : "DELETE")) {
      return;
    }

    setWorkingUserId(user.id);
    setAdminStatusText("");
    try {
      await deleteUserRequest(user.id, { deleteWorkspace });
      setUsers((current) => current.filter((entry) => entry.id !== user.id));
      setAdminStatusText(deleteWorkspace ? "User and workspace deleted." : "User deleted.");
    } catch (error) {
      setAdminStatusText(error instanceof Error ? error.message : "Unable to delete user");
    } finally {
      setWorkingUserId(null);
    }
  }

  async function handleRevokePasswordReset(resetId: string) {
    setRevokingResetId(resetId);
    setAdminStatusText("");
    try {
      await revokePasswordResetRequest(resetId);
      setResets((current) =>
        current.map((reset) =>
          reset.id === resetId ? { ...reset, revokedAt: new Date().toISOString() } : reset
        )
      );
      setAdminStatusText("Password reset revoked.");
    } catch (error) {
      setAdminStatusText(error instanceof Error ? error.message : "Unable to revoke reset");
    } finally {
      setRevokingResetId(null);
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
                    Manage users, account recovery, sessions, and invites.
                  </p>
                </div>
              </div>

              <div className="nl-settings-card">
                <div className="nl-settings-card__header">
                  <div>
                    <strong>Users</strong>
                    <p className="nl-muted-copy">
                      Create accounts directly or manage existing access.
                    </p>
                  </div>
                </div>

                <form
                  className="nl-settings-inline-form nl-admin-create-user-form"
                  onSubmit={handleCreateUser}
                >
                  <Field label="User Email">
                    <TextInput
                      type="email"
                      autoComplete="email"
                      value={userEmail}
                      onChange={(event) => setUserEmail(event.target.value)}
                      placeholder="teammate@example.com"
                      required
                    />
                  </Field>

                  <Field label="Role">
                    <Select
                      value={userRole}
                      onChange={(event) => setUserRole(event.target.value as AuthRole)}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </Select>
                  </Field>

                  <Field label="Password">
                    <TextInput
                      type="password"
                      value={userPassword}
                      onChange={(event) => setUserPassword(event.target.value)}
                      placeholder={shouldGeneratePassword ? "Generated" : "At least 8 characters"}
                      disabled={shouldGeneratePassword}
                      minLength={8}
                    />
                  </Field>

                  <label className="nl-inline-checkbox">
                    <input
                      type="checkbox"
                      checked={shouldGeneratePassword}
                      onChange={(event) => setShouldGeneratePassword(event.target.checked)}
                    />
                    Generate temporary password
                  </label>

                  <div className="nl-settings-inline-form__actions">
                    <Button type="submit" disabled={isSubmittingUser}>
                      {isSubmittingUser ? "Creating..." : "Create User"}
                    </Button>
                  </div>
                </form>

                {latestTemporaryPassword ? (
                  <div className="nl-auth-callout">
                    <strong>Temporary Password</strong>
                    <p>{latestTemporaryPassword}</p>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void navigator.clipboard.writeText(latestTemporaryPassword)
                      }
                    >
                      Copy Password
                    </Button>
                  </div>
                ) : null}

                {latestResetUrl ? (
                  <div className="nl-auth-callout">
                    <strong>Password Reset Link</strong>
                    <p>{latestResetUrl}</p>
                    <Button
                      variant="ghost"
                      onClick={() => void navigator.clipboard.writeText(latestResetUrl)}
                    >
                      Copy Link
                    </Button>
                  </div>
                ) : null}

                {adminStatusText ? (
                  <div className="nl-status-note">{adminStatusText}</div>
                ) : null}

                <div className="nl-admin-user-list">
                  {isLoadingInvites ? (
                    <div className="nl-auth-table__empty">Loading users...</div>
                  ) : users.length === 0 ? (
                    <div className="nl-auth-table__empty">No users created yet.</div>
                  ) : (
                    users.map((user) => (
                      <div key={user.id} className="nl-admin-user-row">
                        <div className="nl-admin-user-row__meta">
                          <span>
                            <strong>{user.email}</strong>
                            <small>Email</small>
                          </span>
                          <span>
                            <strong>{user.role}</strong>
                            <small>Role</small>
                          </span>
                          <span>
                            <strong>{user.disabledAt ? "Suspended" : "Active"}</strong>
                            <small>Status</small>
                          </span>
                          <span>
                            <strong>
                              {user.lastActivityAt
                                ? new Date(user.lastActivityAt).toLocaleString()
                                : `${user.activeSessionCount} sessions`}
                            </strong>
                            <small>Activity</small>
                          </span>
                        </div>
                        <div className="nl-admin-user-row__actions">
                          <Button
                            variant="ghost"
                            disabled={workingUserId === user.id}
                            onClick={() =>
                              void handleUpdateUser(user.id, {
                                role: user.role === "admin" ? "user" : "admin",
                              })
                            }
                          >
                            {user.role === "admin" ? "Make User" : "Make Admin"}
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={workingUserId === user.id}
                            onClick={() =>
                              void handleUpdateUser(user.id, {
                                disabled: !user.disabledAt,
                              })
                            }
                          >
                            {user.disabledAt ? "Restore" : "Suspend"}
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={workingUserId === user.id}
                            onClick={() => void handleCreatePasswordReset(user.id)}
                          >
                            Reset Link
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={workingUserId === user.id}
                            onClick={() => void handleGenerateTemporaryPassword(user.id)}
                          >
                            Temp Password
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={workingUserId === user.id}
                            onClick={() => void handleRevokeSessions(user.id)}
                          >
                            Revoke Sessions
                          </Button>
                          <Button
                            variant="danger"
                            disabled={workingUserId === user.id || user.id === viewer.id}
                            onClick={() => void handleDeleteUser(user, false)}
                          >
                            Delete
                          </Button>
                          <Button
                            variant="danger"
                            disabled={workingUserId === user.id || user.id === viewer.id}
                            onClick={() => void handleDeleteUser(user, true)}
                          >
                            Delete Workspace
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="nl-settings-card">
                <div className="nl-settings-card__header">
                  <div>
                    <strong>Recovery Links</strong>
                    <p className="nl-muted-copy">
                      Reset links are one-time use and expire automatically.
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => void refreshAdminData()}>
                    Refresh
                  </Button>
                </div>

                <div className="nl-auth-table">
                  <div className="nl-auth-table__header">
                    <span>Email</span>
                    <span>Status</span>
                    <span>Created</span>
                    <span>Expires</span>
                    <span />
                  </div>

                  {isLoadingInvites ? (
                    <div className="nl-auth-table__empty">Loading resets...</div>
                  ) : resets.length === 0 ? (
                    <div className="nl-auth-table__empty">No recovery links created yet.</div>
                  ) : (
                    resets.map((reset) => (
                      <div key={reset.id} className="nl-auth-table__row">
                        <span>{reset.email}</span>
                        <span>{resetStateLabel(reset)}</span>
                        <span>{new Date(reset.createdAt).toLocaleString()}</span>
                        <span>{new Date(reset.expiresAt).toLocaleString()}</span>
                        <span>
                          {!reset.usedAt && !reset.revokedAt ? (
                            <Button
                              variant="ghost"
                              disabled={revokingResetId === reset.id}
                              onClick={() => void handleRevokePasswordReset(reset.id)}
                            >
                              {revokingResetId === reset.id ? "Revoking..." : "Revoke"}
                            </Button>
                          ) : null}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="nl-settings-card">
                <div className="nl-settings-card__header">
                  <div>
                    <strong>Invites</strong>
                    <p className="nl-muted-copy">
                      Invite links let users set their own first password.
                    </p>
                  </div>
                </div>

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
