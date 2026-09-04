import {
  Activity,
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Clipboard,
  CloudCog,
  ExternalLink,
  FileText,
  Gauge,
  Info,
  KeyRound,
  LockKeyhole,
  Menu,
  Plus,
  PlugZap,
  RefreshCw,
  Search,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  Type,
  UserPlus,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  type AdminUser,
  type AuditEvent,
  type AuthenticationSettings,
  type OverviewData,
  type PluginCatalog,
  type UserRole,
  type UserStatus,
  type WorkspaceProviderAuth,
  type WorkspaceStatus,
  settingsMutationHeaders,
  settingsRequest,
} from "./settingsApi";
import { readDeviceState, writeDeviceState } from "./deviceState";
import {
  PersonalizationPanel,
  type PersonalizationIdentityProvider,
  type PersonalizationNotice,
  type PersonalizationUser,
} from "./UserSettingsApp";
import "./settings-app.css";

export type SettingsSection = "personalization" | "plugins" | "overview" | "users" | "authentication" | "workspace" | "audit" | "about";

export type SettingsAppProps = {
  administrator?: boolean;
  csrfToken: string;
  currentUserId: string;
  user?: PersonalizationUser;
  providers?: PersonalizationIdentityProvider[];
  initialNotice?: PersonalizationNotice;
  initialSection?: SettingsSection;
  sectionRequest?: { id: string; section: SettingsSection };
  fontScale?: number;
  onFontScaleChange?: (value: number) => void;
  onLogout?: () => void;
  storageNamespace?: string;
  storageArea?: string;
};

type SettingsDeviceState = { section: SettingsSection };

function settingsDeviceState(storageNamespace: string | undefined, storageArea: string, fallback: SettingsSection, allowed: Set<SettingsSection>): SettingsDeviceState {
  const stored = readDeviceState(storageNamespace, storageArea);
  if (!stored || typeof stored !== "object") return { section: fallback };
  const storedSection = (stored as Record<string, unknown>).section;
  const section = storedSection === "mcp" || storedSection === "connectors" ? "plugins" : storedSection;
  return { section: allowed.has(section as SettingsSection) ? section as SettingsSection : fallback };
}

const PERSONALIZATION_NAVIGATION = { id: "personalization", label: "Personalization", description: "Your desktop and account", icon: Type, accent: "violet" } satisfies { id: SettingsSection; label: string; description: string; icon: LucideIcon; accent: string };

const PLUGINS_NAVIGATION = { id: "plugins", label: "Plugins", description: "Private and global tools", icon: PlugZap, accent: "violet" } satisfies { id: SettingsSection; label: string; description: string; icon: LucideIcon; accent: string };

const ADMIN_NAVIGATION: { id: SettingsSection; label: string; description: string; icon: LucideIcon; accent: string }[] = [
  { id: "overview", label: "Overview", description: "Workspace health", icon: Gauge, accent: "cyan" },
  { id: "users", label: "Users", description: "People and access", icon: Users, accent: "pink" },
  { id: "authentication", label: "Authentication", description: "Login providers", icon: KeyRound, accent: "amber" },
  { id: "workspace", label: "Workspace", description: "OpenClaw and Codex", icon: Bot, accent: "coral" },
  { id: "audit", label: "Audit log", description: "Security activity", icon: Activity, accent: "mint" },
  { id: "about", label: "About", description: "Versions and credits", icon: Info, accent: "amber" },
];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatAction(value: string): string {
  return value.replaceAll(/[._-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function hasMetadata(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.keys(value).length > 0;
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : value.slice(0, 2)).toUpperCase();
}

export function SettingsApp({ administrator = true, csrfToken, currentUserId, user, providers = [], initialNotice, initialSection, sectionRequest, fontScale = 100, onFontScaleChange = () => undefined, onLogout = () => undefined, storageNamespace, storageArea = "settings" }: SettingsAppProps) {
  const navigation = administrator ? [PERSONALIZATION_NAVIGATION, PLUGINS_NAVIGATION, ...ADMIN_NAVIGATION] : [PERSONALIZATION_NAVIGATION, PLUGINS_NAVIGATION];
  const allowedSections = new Set(navigation.map((item) => item.id));
  const fallbackSection: SettingsSection = administrator ? "overview" : "personalization";
  const [initialUiState] = useState(() => initialSection && allowedSections.has(initialSection)
    ? { section: initialSection }
    : settingsDeviceState(storageNamespace, storageArea, fallbackSection, allowedSections));
  const [section, setSection] = useState<SettingsSection>(initialUiState.section);
  const [mobileNavigation, setMobileNavigation] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; message: string }>();
  const [overview, setOverview] = useState<OverviewData>();
  const [overviewError, setOverviewError] = useState<string>();
  const [users, setUsers] = useState<AdminUser[]>();
  const [authentication, setAuthentication] = useState<AuthenticationSettings>();
  const [plugins, setPlugins] = useState<PluginCatalog>();
  const [workspace, setWorkspace] = useState<WorkspaceStatus>();
  const [provider, setProvider] = useState<WorkspaceProviderAuth>();
  const [audit, setAudit] = useState<AuditEvent[]>();
  const currentNavigation = navigation.find((item) => item.id === section) ?? PERSONALIZATION_NAVIGATION;

  useEffect(() => {
    writeDeviceState(storageNamespace, storageArea, { section } satisfies SettingsDeviceState);
  }, [section, storageArea, storageNamespace]);

  useEffect(() => {
    if (!sectionRequest || !allowedSections.has(sectionRequest.section)) return;
    setSection(sectionRequest.section);
    setMobileNavigation(false);
  }, [sectionRequest?.id, sectionRequest?.section]);

  const refreshOverview = useCallback(async () => {
    try {
      const next = await settingsRequest<OverviewData>("/api/admin/overview");
      setOverview(next);
      setOverviewError(undefined);
      return next;
    } catch (error) {
      setOverviewError(errorMessage(error, "Settings overview could not be loaded."));
      return undefined;
    }
  }, []);

  const refreshWorkspace = useCallback(async () => {
    try {
      const [nextWorkspace, nextProvider] = await Promise.all([
        settingsRequest<WorkspaceStatus>("/api/workspace"),
        settingsRequest<WorkspaceProviderAuth>("/api/admin/workspace/provider"),
      ]);
      setWorkspace(nextWorkspace);
      setProvider(nextProvider);
      return nextProvider;
    } catch (error) {
      setNotice({ tone: "error", message: errorMessage(error, "Workspace status could not be loaded.") });
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (section === "plugins" && !plugins) {
      void settingsRequest<PluginCatalog>("/api/plugins")
        .then(setPlugins)
        .catch((error: unknown) => setNotice({ tone: "error", message: errorMessage(error, "Plugins could not be loaded.") }));
    }
    if (!administrator) return;
    void refreshOverview();
  }, [administrator, plugins, refreshOverview, section]);

  useEffect(() => {
    if (!administrator) return;
    if (section === "users" && !users) {
      void settingsRequest<{ users: AdminUser[] }>("/api/admin/users")
        .then((result) => setUsers(result.users))
        .catch((error: unknown) => setNotice({ tone: "error", message: errorMessage(error, "Users could not be loaded.") }));
    }
    if (section === "authentication" && !authentication) {
      void settingsRequest<AuthenticationSettings>("/api/admin/authentication")
        .then(setAuthentication)
        .catch((error: unknown) => setNotice({ tone: "error", message: errorMessage(error, "Authentication settings could not be loaded.") }));
    }
    if (section === "workspace" && (!workspace || !provider)) void refreshWorkspace();
    if (section === "audit" && !audit) {
      void settingsRequest<{ events: AuditEvent[] }>("/api/admin/audit?limit=100")
        .then((result) => setAudit(result.events))
        .catch((error: unknown) => setNotice({ tone: "error", message: errorMessage(error, "Audit events could not be loaded.") }));
    }
  }, [administrator, audit, authentication, plugins, provider, refreshWorkspace, section, users, workspace]);

  useEffect(() => {
    if (!administrator || section !== "workspace" || (provider?.state !== "starting" && provider?.state !== "awaiting_user")) return;
    const interval = window.setInterval(() => void refreshWorkspace(), 2_000);
    return () => window.clearInterval(interval);
  }, [administrator, provider?.state, refreshWorkspace, section]);

  const chooseSection = (next: SettingsSection) => {
    if (!allowedSections.has(next)) return;
    setSection(next);
    setMobileNavigation(false);
    setNotice(undefined);
  };

  const refreshAfterMutation = () => {
    void refreshOverview();
  };

  return (
    <div className="settings-app">
      {mobileNavigation && <button type="button" className="settings-app__scrim" aria-label="Close settings navigation" onClick={() => setMobileNavigation(false)} />}

      <aside className={`settings-sidebar${mobileNavigation ? " settings-sidebar--open" : ""}`} aria-label="Settings navigation">
        <header className="settings-sidebar__heading">
          <div className="settings-sidebar__mark"><SettingsIcon /></div>
          <div><span>Neural Labs</span><strong>{administrator ? "Workspace settings" : "Personal settings"}</strong></div>
          <button type="button" aria-label="Close settings navigation" onClick={() => setMobileNavigation(false)}><X /></button>
        </header>
        <nav>
          <span>Personal</span>
          {[PERSONALIZATION_NAVIGATION].map(({ id, label, description, icon: Icon, accent }) => (
            <button type="button" className={`is-${accent}${section === id ? " is-active" : ""}`} aria-current={section === id ? "page" : undefined} key={id} onClick={() => chooseSection(id)}>
              <i><Icon /></i><span><strong>{label}</strong><small>{description}</small></span><ChevronRight />
            </button>
          ))}
          <span>Workspace</span>
          {[PLUGINS_NAVIGATION].map(({ id, label, description, icon: Icon, accent }) => (
            <button type="button" className={`is-${accent}${section === id ? " is-active" : ""}`} aria-current={section === id ? "page" : undefined} key={id} onClick={() => chooseSection(id)}>
              <i><Icon /></i><span><strong>{label}</strong><small>{description}</small></span><ChevronRight />
            </button>
          ))}
          {administrator && <><span>Control plane</span>{ADMIN_NAVIGATION.map(({ id, label, description, icon: Icon, accent }) => (
            <button type="button" className={`is-${accent}${section === id ? " is-active" : ""}`} aria-current={section === id ? "page" : undefined} key={id} onClick={() => chooseSection(id)}>
              <i><Icon /></i><span><strong>{label}</strong><small>{description}</small></span><ChevronRight />
            </button>
          ))}</>}
        </nav>
        {administrator ? <div className="settings-sidebar__health">
          <div><span><i className={overview?.workspace.status === "ready" ? "" : "is-offline"} />Workspace</span><strong>{overview?.workspace.status ?? "Checking"}</strong></div>
          <small>Administrative mutations are rechecked by the control plane.</small>
        </div> : <div className="settings-sidebar__health"><div><span><UserRound />Your account</span><strong>{user?.displayName ?? "Member"}</strong></div><small>Personalization changes affect only your signed-in desktop.</small></div>}
      </aside>

      <main className="settings-main">
        <header className="settings-toolbar">
          <button type="button" className="settings-icon-button settings-toolbar__menu" aria-label="Open settings navigation" onClick={() => setMobileNavigation(true)}><Menu /></button>
          <div><span>Settings</span><ChevronRight /><strong>{currentNavigation.label}</strong></div>
          <span className="settings-toolbar__scope">{administrator ? <ShieldCheck /> : <UserRound />}{administrator ? "Administrator" : section === "plugins" ? "Workspace member" : "Personal"}</span>
        </header>

        <div className="settings-feedback">{notice && <div className={`settings-notice is-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}><span>{notice.message}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice(undefined)}><X /></button></div>}</div>

        <div className="settings-scroll">
          {section === "personalization" && user && <PersonalizationPanel user={user} providers={providers} csrfToken={csrfToken} initialNotice={initialNotice} fontScale={fontScale} onFontScaleChange={onFontScaleChange} onLogout={onLogout} />}
          {section === "plugins" && <PluginsPanel catalog={plugins} administrator={administrator} />}
          {administrator && section === "overview" && <OverviewPanel overview={overview} error={overviewError} onNavigate={chooseSection} onRefresh={() => void refreshOverview()} />}
          {administrator && section === "users" && <UsersPanel users={users} currentUserId={currentUserId} csrfToken={csrfToken} onUsers={setUsers} onNotice={setNotice} onMutated={refreshAfterMutation} />}
          {administrator && section === "authentication" && <AuthenticationPanel settings={authentication} csrfToken={csrfToken} onSettings={setAuthentication} onNotice={setNotice} onMutated={refreshAfterMutation} />}
          {administrator && section === "workspace" && <WorkspacePanel workspace={workspace} provider={provider} csrfToken={csrfToken} onProvider={setProvider} onNotice={setNotice} onRefresh={() => void refreshWorkspace()} />}
          {administrator && section === "audit" && <AuditPanel events={audit} />}
          {administrator && section === "about" && <AboutPanel overview={overview} />}
        </div>
      </main>
    </div>
  );
}

function SectionHeader({ eyebrow, title, description, icon: Icon }: { eyebrow: string; title: string; description: string; icon: LucideIcon }) {
  return <div className="settings-section-header"><div><span><Icon />{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></div>;
}

function LoadingPanel({ label }: { label: string }) {
  return <div className="settings-empty settings-loading" role="status"><RefreshCw /><strong>{label}</strong></div>;
}

function OverviewPanel({ overview, error, onNavigate, onRefresh }: { overview?: OverviewData; error?: string; onNavigate: (section: SettingsSection) => void; onRefresh: () => void }) {
  if (error) return <div className="settings-panel"><SectionHeader eyebrow="Control plane" title="Overview" description={error} icon={Gauge} /><button className="settings-button is-primary" type="button" onClick={onRefresh}>Try again</button></div>;
  if (!overview) return <LoadingPanel label="Loading admin settings" />;
  return (
    <div className="settings-panel">
      <SectionHeader eyebrow="Control plane" title="Overview" description="Identity, authentication, plugins, and the shared OpenClaw workspace at a glance." icon={Gauge} />
      <div className="settings-overview-grid">
        <OverviewCard accent="pink" label="Pending requests" value={String(overview.counts.pending)} detail="Waiting for review" onClick={() => onNavigate("users")} />
        <OverviewCard accent="amber" label="Login providers" value={String(Number(overview.authentication.localEnabled) + Number(overview.authentication.microsoftEnabled))} detail={overview.authentication.microsoftEnabled ? "Microsoft enabled" : "Local only"} onClick={() => onNavigate("authentication")} />
        <OverviewCard accent="violet" label="Plugins" value="1 global" detail={`${overview.mcp.tools.length} tools · ${overview.mcp.ready ? "ready" : "offline"}`} onClick={() => onNavigate("plugins")} />
        <OverviewCard accent="coral" label="Workspace" value={overview.workspace.status} detail={`OpenClaw ${overview.workspace.openclawVersion}`} onClick={() => onNavigate("workspace")} />
      </div>
      <div className="settings-mcp-grid">
        <section className="settings-card">
          <div className="settings-card__heading"><div><span>Recent activity</span><h2>Security-sensitive changes</h2><p>The latest events recorded by the control plane.</p></div><Activity /></div>
          <div className="settings-activity-list">
            {overview.recentAudit.length ? overview.recentAudit.map((event) => <div key={event.id}><i /><span><strong>{formatAction(event.action)}</strong><small>{event.actorName ?? "System"}{event.targetName ? ` → ${event.targetName}` : ""}</small></span><time>{formatDate(event.createdAt)}</time></div>) : <p>No administrative events yet.</p>}
          </div>
          <button className="settings-text-button" type="button" onClick={() => onNavigate("audit")}>Open audit log <ChevronRight /></button>
        </section>
        <section className="settings-card">
          <div className="settings-card__heading"><div><span>System status</span><h2>Shared services</h2><p>Live configuration and runtime state.</p></div><CloudCog /></div>
          <div className="settings-system-list">
            <ServiceRow label="Local authentication" ready={overview.authentication.localEnabled} value={overview.authentication.localEnabled ? "Enabled" : "Disabled"} />
            <ServiceRow label="Microsoft Entra" ready={overview.authentication.microsoftEnabled} value={overview.authentication.microsoftEnabled ? "Enabled" : overview.authentication.microsoftAvailable ? "Available" : "Not configured"} />
            <ServiceRow label="Neural Labs Tools" ready={overview.mcp.ready} value={overview.mcp.ready ? "Connected" : "Offline"} />
            <ServiceRow label="OpenClaw workspace" ready={overview.workspace.status === "ready"} value={overview.workspace.status} />
          </div>
        </section>
      </div>
    </div>
  );
}

function OverviewCard({ accent, label, value, detail, onClick }: { accent: string; label: string; value: string; detail: string; onClick: () => void }) {
  return <button type="button" className={`settings-overview-card is-${accent}`} onClick={onClick}><span>{label}</span><strong>{value}</strong><small>{detail}</small><ChevronRight /></button>;
}

function ServiceRow({ label, ready, value }: { label: string; ready: boolean; value: string }) {
  return <div><span><i className={ready ? "is-mint" : ""} />{label}</span><strong className={ready ? "" : "is-muted"}>{value}</strong></div>;
}

type NoticeSetter = (notice: { tone: "success" | "error" | "info"; message: string } | undefined) => void;

function UsersPanel({ users, currentUserId, csrfToken, onUsers, onNotice, onMutated }: { users?: AdminUser[]; currentUserId: string; csrfToken: string; onUsers: (users: AdminUser[]) => void; onNotice: NoticeSetter; onMutated: () => void }) {
  const [filter, setFilter] = useState<"all" | "pending" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");
  const [workingUser, setWorkingUser] = useState<string>();
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (users ?? []).filter((user) => {
      const matchesText = !query || `${user.displayName} ${user.email} ${user.handle}`.toLowerCase().includes(query);
      const matchesStatus = filter === "all" || user.status === filter || (filter === "inactive" && (user.status === "disabled" || user.status === "rejected"));
      return matchesText && matchesStatus;
    });
  }, [filter, search, users]);

  async function updateUser(user: AdminUser, input: { status?: UserStatus; role?: UserRole }, confirmation?: string) {
    if (confirmation && !window.confirm(confirmation)) return;
    setWorkingUser(user.id);
    onNotice(undefined);
    try {
      const result = await settingsRequest<{ user: Omit<AdminUser, "providers"> }>(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: settingsMutationHeaders(csrfToken),
        body: JSON.stringify(input),
      });
      onUsers((users ?? []).map((entry) => entry.id === user.id ? { ...entry, ...result.user } : entry));
      onNotice({ tone: "success", message: `${user.displayName} was updated.` });
      onMutated();
    } catch (error) {
      onNotice({ tone: "error", message: errorMessage(error, "The user could not be updated.") });
    } finally {
      setWorkingUser(undefined);
    }
  }

  if (!users) return <LoadingPanel label="Loading users" />;
  const active = users.filter((user) => user.status === "active").length;
  const pending = users.filter((user) => user.status === "pending").length;
  const admins = users.filter((user) => user.status === "active" && user.role === "admin").length;
  return (
    <div className="settings-panel">
      <SectionHeader eyebrow="People and access" title="Users" description="Review requests, manage account status, and assign administrator access." icon={Users} />
      <div className="settings-metrics">
        <div className="is-cyan"><Users /><span><strong>{active}</strong><small>Active users</small></span></div>
        <div className="is-violet"><UserPlus /><span><strong>{pending}</strong><small>Pending requests</small></span></div>
        <div className="is-pink"><ShieldCheck /><span><strong>{admins}</strong><small>Administrators</small></span></div>
      </div>
      <section className="settings-card settings-users-card">
        <div className="settings-users-toolbar">
          <div role="group" aria-label="Filter users by status">{(["all", "pending", "active", "inactive"] as const).map((value) => <button type="button" aria-pressed={filter === value} key={value} onClick={() => setFilter(value)}>{value}</button>)}</div>
          <label><Search /><span className="settings-sr-only">Search users</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people" /></label>
        </div>
        <div className="settings-user-list" role="table" aria-label="Workspace users">
          <div className="settings-user-list__head" role="row"><span>User</span><span>Role</span><span>Status</span><span>Joined</span><span>Actions</span></div>
          {visible.map((user) => <UserRow key={user.id} user={user} isSelf={user.id === currentUserId} busy={workingUser === user.id} onUpdate={updateUser} />)}
          {!visible.length && <div className="settings-empty"><Search /><strong>No matching users</strong><p>Try another status or search term.</p></div>}
        </div>
      </section>
      <p className="settings-trust-note"><ShieldCheck />Approved users share files, agent history, automations, and workspace credentials. Use separate deployments for people who are not mutually trusted.</p>
    </div>
  );
}

function UserRow({ user, isSelf, busy, onUpdate }: { user: AdminUser; isSelf: boolean; busy: boolean; onUpdate: (user: AdminUser, input: { status?: UserStatus; role?: UserRole }, confirmation?: string) => Promise<void> }) {
  const provider = user.providers.map((value) => value === "microsoft" ? "Microsoft" : "Local").join(" · ") || "No identity";
  return (
    <article className="settings-user-row" role="row">
      <div className="settings-user-identity" role="cell"><span className="is-cyan">{initials(user.displayName)}</span><div><strong>{user.displayName}{isSelf ? " (you)" : ""}</strong><small>{user.email} · @{user.handle}</small><em>{provider}</em></div></div>
      <div role="cell" data-label="Role"><select aria-label={`Role for ${user.displayName}`} value={user.role} disabled={busy || user.status !== "active" || isSelf} onChange={(event) => void onUpdate(user, { role: event.target.value as UserRole }, `${event.target.value === "admin" ? "Grant" : "Remove"} administrator access for ${user.displayName}?`)}><option value="user">User</option><option value="admin">Admin</option></select></div>
      <div role="cell" data-label="Status"><span className={`settings-status is-${user.status}`}><i />{user.status}</span></div>
      <div role="cell" data-label="Joined"><span className="settings-last-seen">{formatDate(user.createdAt)}</span></div>
      <div className="settings-user-actions" role="cell">
        {user.status === "pending" && <><button type="button" className="is-primary" disabled={busy} onClick={() => void onUpdate(user, { status: "active" })}>Approve</button><button type="button" className="is-danger" disabled={busy} onClick={() => void onUpdate(user, { status: "rejected" }, `Reject ${user.displayName}'s access request?`)}>Reject</button></>}
        {(user.status === "disabled" || user.status === "rejected") && <button type="button" className="is-primary" disabled={busy} onClick={() => void onUpdate(user, { status: "active" })}>Activate</button>}
        {user.status === "active" && !isSelf && <button type="button" className="is-danger" disabled={busy} onClick={() => void onUpdate(user, { status: "disabled" }, `Disable ${user.displayName}? Their sessions will be revoked.`)}>Disable</button>}
      </div>
    </article>
  );
}

function AuthenticationPanel({ settings, csrfToken, onSettings, onNotice, onMutated }: { settings?: AuthenticationSettings; csrfToken: string; onSettings: (settings: AuthenticationSettings) => void; onNotice: NoticeSetter; onMutated: () => void }) {
  if (!settings) return <LoadingPanel label="Loading authentication settings" />;
  return <AuthenticationForm key={settings.updatedAt} settings={settings} csrfToken={csrfToken} onSettings={onSettings} onNotice={onNotice} onMutated={onMutated} />;
}

function AuthenticationForm({ settings, csrfToken, onSettings, onNotice, onMutated }: { settings: AuthenticationSettings; csrfToken: string; onSettings: (settings: AuthenticationSettings) => void; onNotice: NoticeSetter; onMutated: () => void }) {
  const [localEnabled, setLocalEnabled] = useState(settings.localAuthEnabled);
  const [microsoftEnabled, setMicrosoftEnabled] = useState(settings.microsoftAuthEnabled);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    onNotice(undefined);
    try {
      const next = await settingsRequest<AuthenticationSettings>("/api/admin/authentication", {
        method: "PUT",
        headers: settingsMutationHeaders(csrfToken),
        body: JSON.stringify({ localAuthEnabled: localEnabled, microsoftAuthEnabled: microsoftEnabled }),
      });
      onSettings(next);
      onNotice({ tone: "success", message: "Authentication settings were saved." });
      onMutated();
    } catch (error) {
      onNotice({ tone: "error", message: errorMessage(error, "Authentication settings could not be saved.") });
    } finally {
      setSaving(false);
    }
  }

  async function rotate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const certificate = form.get("certificate");
    if (!String(form.get("client_secret") ?? "").trim() && (!(certificate instanceof File) || certificate.size === 0)) {
      onNotice({ tone: "error", message: "Choose a new client secret or PEM credential." });
      return;
    }
    setRotating(true);
    onNotice(undefined);
    try {
      const next = await settingsRequest<AuthenticationSettings>("/api/admin/entra", {
        method: "POST",
        headers: settingsMutationHeaders(csrfToken),
        body: form,
      });
      onSettings(next);
      formElement.reset();
      onNotice({ tone: "success", message: "Microsoft credential was validated and replaced." });
      onMutated();
    } catch (error) {
      onNotice({ tone: "error", message: errorMessage(error, "Microsoft credential could not be replaced.") });
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="settings-panel">
      <SectionHeader eyebrow="Identity providers" title="Authentication" description="Control sign-in methods and rotate the confidential Microsoft Entra credential." icon={KeyRound} />
      <div className="settings-mcp-grid">
        <section className="settings-card">
          <div className="settings-card__heading"><div><span>Web access</span><h2>Login providers</h2><p>At least one provider must stay enabled.</p></div><ShieldCheck /></div>
          <form className="settings-stack" onSubmit={save}>
            <ToggleRow label="Local login" description="Email and password accounts" checked={localEnabled} onChange={setLocalEnabled} />
            <ToggleRow label="Microsoft Entra" description={settings.microsoftAvailable ? `Credential from ${settings.microsoftSource}` : "No credential available"} checked={microsoftEnabled} disabled={!settings.microsoftAvailable} onChange={setMicrosoftEnabled} />
            <p className="settings-trust-note">Link Microsoft to an active administrator before disabling local login.</p>
            <button className="settings-button is-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save login settings"}</button>
          </form>
        </section>
        <section className="settings-card">
          <div className="settings-card__heading"><div><span>Microsoft Entra</span><h2>Current configuration</h2><p>Secret material is never returned to the browser.</p></div><span className={`settings-service-state${settings.entra ? " is-ready" : ""}`}><i />{settings.entra ? "Configured" : "Not configured"}</span></div>
          {settings.entra ? <dl className="settings-detail-list"><div><dt>Tenant ID</dt><dd><code>{settings.entra.tenantId}</code></dd></div><div><dt>Client ID</dt><dd><code>{settings.entra.clientId}</code></dd></div><div><dt>Authority</dt><dd><code>{settings.entra.authorityHost}</code></dd></div><div><dt>Credential</dt><dd>{settings.entra.credentialType}{settings.entra.certificateExpiresAt ? ` · expires ${formatDate(settings.entra.certificateExpiresAt)}` : ""}</dd></div></dl> : <p className="settings-card-note">Microsoft credentials have not been configured.</p>}
          {settings.callbackUrl && <CopyField label="Web redirect URI" value={settings.callbackUrl} onCopied={() => onNotice({ tone: "success", message: "Redirect URI copied." })} />}
        </section>
      </div>
      <section className="settings-card">
        <div className="settings-card__heading"><div><span>Credential rotation</span><h2>Validate and replace</h2><p>Provide tenant and client identifiers plus either a new client secret or PEM bundle.</p></div><RefreshCw /></div>
        <form className="settings-form-grid" onSubmit={rotate}>
          <SettingsField label="Tenant ID"><input name="tenant_id" type="text" defaultValue={settings.entra?.tenantId ?? ""} autoComplete="off" required /></SettingsField>
          <SettingsField label="Application (client) ID"><input name="client_id" type="text" defaultValue={settings.entra?.clientId ?? ""} autoComplete="off" required /></SettingsField>
          <SettingsField label="Authority host" wide><input name="authority_host" type="url" defaultValue={settings.entra?.authorityHost ?? "https://login.microsoftonline.com"} required /></SettingsField>
          <SettingsField label="New client secret" hint="Leave empty when uploading a certificate."><input name="client_secret" type="password" autoComplete="new-password" /></SettingsField>
          <SettingsField label="Certificate credential PEM"><input name="certificate" type="file" accept=".pem,application/x-pem-file" /></SettingsField>
          <SettingsField label="PEM passphrase"><input name="certificate_passphrase" type="password" autoComplete="new-password" /></SettingsField>
          <div className="settings-form-submit"><button className="settings-button" type="submit" disabled={rotating}>{rotating ? "Validating…" : "Validate and replace credential"}</button></div>
        </form>
      </section>
    </div>
  );
}

function PluginsPanel({ catalog, administrator }: { catalog?: PluginCatalog; administrator: boolean }) {
  const [adding, setAdding] = useState(false);
  const [scope, setScope] = useState<"all" | "private" | "global">("all");
  const [newScope, setNewScope] = useState<"private" | "global">("private");
  if (!catalog) return <LoadingPanel label="Loading plugins" />;

  const privatePlugins = catalog.plugins.filter((plugin) => plugin.scope === "private");
  const globalPlugins = catalog.plugins.filter((plugin) => plugin.scope === "global");
  const toolCount = catalog.plugins.reduce((total, plugin) => total + plugin.mcp.tools.length, 0);

  if (adding) {
    return (
      <div className="settings-panel">
        <button className="settings-back-button" type="button" onClick={() => setAdding(false)}><ArrowLeft />All plugins</button>
        <SectionHeader eyebrow="New integration" title="Add a plugin" description="Install capabilities for your agents or the whole workspace." icon={Plus} />
        <div className="settings-plugin-scope-picker" aria-label="Plugin scope">
          <button type="button" className={newScope === "private" ? "is-active" : ""} onClick={() => setNewScope("private")}><UserRound /><span><strong>Private plugin</strong><small>Only your agents · your credentials</small></span><Check /></button>
          <button type="button" className={newScope === "global" ? "is-active" : ""} disabled={!administrator} onClick={() => setNewScope("global")}><Users /><span><strong>Global plugin</strong><small>Every member · administrator managed</small></span>{administrator ? <Check /> : <LockKeyhole />}</button>
        </div>
        <section className="settings-card settings-connector-choice">
          <div className="settings-connector-choice__icon"><Server /></div>
          <div><span>Connection-only plugin</span><h2>MCP server</h2><p>Attach a remote Model Context Protocol server and authenticate it for {newScope === "private" ? "your own agents" : "everyone in the workspace"}.</p><div><code>OAuth</code><code>Access token</code><code>Streamable HTTP</code></div></div>
          <span className="settings-connector-planned">In development</span>
        </section>
        <section className="settings-connector-roadmap">
          <div><span>1</span><strong>Discover</strong><small>Validate its HTTPS URL and inspect tools.</small></div>
          <div><span>2</span><strong>Authenticate</strong><small>{newScope === "private" ? "Connect your own account." : "Configure workspace credentials."}</small></div>
          <div><span>3</span><strong>Review access</strong><small>Choose tools and confirmation rules.</small></div>
        </section>
        <p className="settings-trust-note"><ShieldCheck />This installation flow is a product preview. Neural Labs will not accept server URLs or credentials until the isolated credential broker and per-plugin permission controls are available.</p>
      </div>
    );
  }

  return (
    <div className="settings-panel">
      <div className="settings-connectors-heading"><SectionHeader eyebrow="Agent extensions" title="Plugins" description="Skills, services, and MCP tools installed privately or across the workspace." icon={PlugZap} /><button className="settings-button is-primary" type="button" onClick={() => setAdding(true)}><Plus />Add plugin</button></div>
      <div className="settings-connector-summary" aria-label="Plugin summary"><div><strong>{privatePlugins.length}</strong><span>Private</span></div><div><strong>{globalPlugins.length}</strong><span>Global</span></div><div><strong>{toolCount}</strong><span>Tools available</span></div></div>
      <div className="settings-plugin-tabs" role="tablist" aria-label="Plugin scope"><button type="button" role="tab" aria-selected={scope === "all"} className={scope === "all" ? "is-active" : ""} onClick={() => setScope("all")}>All</button><button type="button" role="tab" aria-selected={scope === "private"} className={scope === "private" ? "is-active" : ""} onClick={() => setScope("private")}>Private</button><button type="button" role="tab" aria-selected={scope === "global"} className={scope === "global" ? "is-active" : ""} onClick={() => setScope("global")}>Global</button></div>

      {(scope === "all" || scope === "private") && <section className="settings-plugin-group" aria-labelledby="private-plugins-title"><div className="settings-plugin-group__heading"><div><span><UserRound />Private</span><h2 id="private-plugins-title">Your plugins</h2><p>Only your agents can use these connections. Credentials belong to your account.</p></div></div>{privatePlugins.length === 0 && <button className="settings-plugin-empty" type="button" onClick={() => { setNewScope("private"); setAdding(true); }}><span><Plus /></span><div><strong>Add your first private plugin</strong><small>Connect personal services such as notes, calendars, or project tools without sharing your account.</small></div><ChevronRight /></button>}</section>}

      {(scope === "all" || scope === "global") && <section className="settings-plugin-group" aria-labelledby="global-plugins-title"><div className="settings-plugin-group__heading"><div><span><Users />Global</span><h2 id="global-plugins-title">Workspace plugins</h2><p>Available to every member. Administrators manage installation and shared access.</p></div></div>{globalPlugins.map((plugin) => {
        const mcp = plugin.mcp;
        return <section className="settings-card settings-connector-card" key={plugin.id}>
          <header><div className="settings-connector-card__mark"><PlugZap /></div><div className="settings-connector-card__identity"><span>Built in · MCP</span><h2>{plugin.name}</h2><p>{plugin.description}</p></div><div className="settings-connector-card__states"><span className="settings-locked-state"><LockKeyhole />System</span><span className={`settings-service-state${plugin.ready ? " is-ready" : ""}`}><i />{plugin.ready ? "Connected" : "Offline"}</span></div></header>
          <p className="settings-connector-lock-note"><LockKeyhole />Installed with Neural Labs. This global system plugin cannot be edited, disconnected, or removed.</p>
          <div className="settings-mcp-grid settings-connector-details"><section><div className="settings-card__heading"><div><span>Attachment</span><h2>Shared OpenClaw agents</h2><p>Supplied to every shared agent automatically.</p></div><Bot /></div><dl className="settings-detail-list"><div><dt>Server name</dt><dd><code>{mcp.agentServerName}</code></dd></div><div><dt>Scope</dt><dd>Global · all members</dd></div><div><dt>Transport</dt><dd>{mcp.transport}</dd></div><div><dt>Internal endpoint</dt><dd><code>{mcp.endpoint}</code></dd></div><div><dt>Public access</dt><dd>Disabled</dd></div></dl></section><section><div className="settings-card__heading"><div><span>Provider readiness</span><h2>Credentials loaded</h2><p>Secret material is never returned here.</p></div><CloudCog /></div><div className="settings-system-list"><ServiceRow label="Google Places" ready={mcp.providers.googlePlaces} value={mcp.providers.googlePlaces ? "Configured" : "Missing"} /><ServiceRow label="Google Geocoding" ready={mcp.providers.googleGeocoding} value={mcp.providers.googleGeocoding ? "Configured" : "Missing"} /><ServiceRow label="KLIPY" ready={mcp.providers.klipy} value={mcp.providers.klipy ? "Configured" : "Missing"} /><ServiceRow label="Pexels" ready={mcp.providers.pexels} value={mcp.providers.pexels ? "Configured" : "Missing"} /></div></section></div>
          <div className="settings-connector-tools"><div><span>Registered capabilities</span><strong>{mcp.tools.length} tools available</strong></div><div className="settings-tool-list">{mcp.tools.length ? mcp.tools.map((tool) => <code key={tool}>{tool}</code>) : <p className="settings-card-note">No provider tools are currently registered.</p>}</div></div>
        </section>;
      })}{administrator && <button className="settings-connector-add-card" type="button" onClick={() => { setNewScope("global"); setAdding(true); }}><span><Plus /></span><div><strong>Add a global plugin</strong><small>Install tools and services for everyone in the workspace.</small></div><ChevronRight /></button>}</section>}
    </div>
  );
}

function WorkspacePanel({ workspace, provider, csrfToken, onProvider, onNotice, onRefresh }: { workspace?: WorkspaceStatus; provider?: WorkspaceProviderAuth; csrfToken: string; onProvider: (provider: WorkspaceProviderAuth) => void; onNotice: NoticeSetter; onRefresh: () => void }) {
  const [working, setWorking] = useState(false);
  const providerBusy = provider?.state === "starting" || provider?.state === "awaiting_user";
  useEffect(() => {
    if (!providerBusy) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      timer = setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      try {
        const next = await settingsRequest<WorkspaceProviderAuth>("/api/admin/workspace/provider");
        if (!active) return;
        onProvider(next);
        if (next.state === "starting" || next.state === "awaiting_user") schedule(1_000);
      } catch {
        if (active) schedule(2_000);
      }
    };

    schedule(250);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [providerBusy, onProvider]);

  if (!workspace || !provider) return <LoadingPanel label="Loading workspace status" />;
  async function mutate(action: "connect" | "cancel") {
    setWorking(true);
    onNotice(undefined);
    try {
      const next = await settingsRequest<WorkspaceProviderAuth>(`/api/admin/workspace/provider/${action}`, { method: "POST", headers: settingsMutationHeaders(csrfToken), body: JSON.stringify({}) });
      onProvider(next);
    } catch (error) {
      onNotice({ tone: "error", message: errorMessage(error, "OpenAI sign-in could not be updated.") });
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="settings-panel">
      <SectionHeader eyebrow="Developer environment" title="Workspace" description="Manage the continuously running OpenClaw environment shared by approved collaborators." icon={Bot} />
      <div className="settings-mcp-grid">
        <section className="settings-card"><div className="settings-card__heading"><div><span>Service state</span><h2>OpenClaw Gateway</h2><p>Runtime, model, and persistent storage status.</p></div><span className={`settings-service-state${workspace.status === "ready" ? " is-ready" : ""}`}><i />{workspace.status}</span></div><dl className="settings-detail-list"><div><dt>OpenClaw</dt><dd><code>{workspace.openclawVersion}</code></dd></div><div><dt>Codex CLI</dt><dd><code>{workspace.codexVersion}</code></dd></div><div><dt>OpenAI account</dt><dd>{workspace.codexAuthenticated ? "Connected" : "Required"}</dd></div><div><dt>Agent model</dt><dd>{workspace.openclawModelReady ? "Ready" : "Configuration required"}</dd></div><div><dt>Storage</dt><dd>{workspace.persistent ? "Persistent shared home" : "Ephemeral"}</dd></div></dl><button className="settings-button" type="button" onClick={onRefresh}><RefreshCw />Refresh status</button></section>
        <section className="settings-card"><div className="settings-card__heading"><div><span>Model provider</span><h2>OpenAI Codex</h2><p>Connect ChatGPT through OpenClaw. No API key is required.</p></div><span className={`settings-service-state${provider.authenticated ? " is-ready" : ""}`}><i />{provider.authenticated ? "Connected" : provider.state.replaceAll("_", " ")}</span></div>{provider.state === "awaiting_user" && provider.verificationUrl && provider.userCode && <div className="settings-device-code"><span>One-time code</span><code>{provider.userCode}</code><p>Open the secure OpenAI sign-in page and enter this code. Keep Settings open while Neural Labs confirms the account.</p><div><a className="settings-button is-primary" href={provider.verificationUrl} target="_blank" rel="noreferrer">Open OpenAI sign-in <ExternalLink /></a><button className="settings-button" type="button" onClick={() => void copyValue(provider.userCode!, () => onNotice({ tone: "success", message: "Device code copied." }))}>Copy code</button><button className="settings-button is-quiet" type="button" disabled={working} onClick={() => void mutate("cancel")}>Cancel</button></div>{provider.expiresAt && <small>Expires {formatDate(provider.expiresAt)}</small>}</div>}{provider.state === "starting" && <p className="settings-card-note">Requesting a device code from OpenAI…</p>}{provider.state === "connected" && <p className="settings-success-note"><Check />Neura is connected to your ChatGPT/Codex subscription through OpenClaw.</p>}{provider.state === "error" && <p className="settings-error-note">{provider.message ?? "OpenAI sign-in did not complete."}</p>}{!providerBusy && !provider.authenticated && <button className="settings-button is-primary" type="button" disabled={working} onClick={() => void mutate("connect")}>{working ? "Starting…" : provider.state === "error" ? "Try again" : "Connect ChatGPT account"}</button>}<p className="settings-trust-note">OAuth credentials stay in OpenClaw's persistent workspace volume. They are never copied into the control plane or root <code>.env</code>.</p></section>
      </div>
      <p className="settings-trust-note"><ShieldCheck />All active users are trusted co-maintainers. Workspace sudo cannot access the host, Docker socket, database, or control-plane secrets.</p>
    </div>
  );
}

function AuditPanel({ events }: { events?: AuditEvent[] }) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return !query ? events ?? [] : (events ?? []).filter((event) => `${event.action} ${event.actorName ?? ""} ${event.targetName ?? ""} ${JSON.stringify(event.metadata)}`.toLowerCase().includes(query));
  }, [events, search]);
  if (!events) return <LoadingPanel label="Loading audit history" />;
  return (
    <div className="settings-panel">
      <SectionHeader eyebrow="Accountability" title="Audit log" description="The latest security-sensitive configuration and account changes." icon={Activity} />
      <section className="settings-card settings-audit-card"><div className="settings-users-toolbar settings-audit-toolbar"><span>{events.length} recent event{events.length === 1 ? "" : "s"}</span><label><Search /><span className="settings-sr-only">Search audit events</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search events" /></label></div><div className="settings-audit-list">{visible.map((event) => <article key={event.id}><div><time>{formatDate(event.createdAt)}</time><span>#{event.id}</span></div><div><h2>{formatAction(event.action)}</h2><p><strong>{event.actorName ?? "System"}</strong>{event.targetName ? <> changed <strong>{event.targetName}</strong></> : ""}</p>{hasMetadata(event.metadata) && <pre>{JSON.stringify(event.metadata, null, 2)}</pre>}</div></article>)}{!visible.length && <div className="settings-empty"><Search /><strong>No matching events</strong><p>Administrative activity will appear here.</p></div>}</div></section>
    </div>
  );
}

function AboutPanel({ overview }: { overview?: OverviewData }) {
  return (
    <div className="settings-panel">
      <SectionHeader eyebrow="Product and runtime" title="About" description="The people, platform, and open tools behind this shared workspace." icon={Info} />
      <section className="settings-about-hero"><div className="settings-about-hero__mark"><span>N</span></div><div><span>Neural Labs</span><h2>A colorful place to build together.</h2><p>Shared workflows, skills, files, and agent context—powered by OpenClaw and shaped for teams.</p><div><a href="https://alshival.ai" target="_blank" rel="noreferrer">Developed by Alshival.Ai <ExternalLink /></a><a href="https://github.com/Alshival-Ai/neural-labs" target="_blank" rel="noreferrer">Source code <ExternalLink /></a></div></div></section>
      <div className="settings-about-grid"><section className="settings-card"><div className="settings-card__heading"><div><span>Versions</span><h2>Runtime stack</h2><p>Components running in this shared environment.</p></div><Gauge /></div><dl className="settings-detail-list"><div><dt>Neural Labs</dt><dd><code>v0.3.2</code></dd></div><div><dt>OpenClaw</dt><dd><code>{overview?.workspace.openclawVersion ?? "Checking"}</code></dd></div><div><dt>Codex CLI</dt><dd><code>{overview?.workspace.codexVersion ?? "Checking"}</code></dd></div><div><dt>Theme</dt><dd>Spectrum Paper</dd></div></dl></section><section className="settings-card"><div className="settings-card__heading"><div><span>System</span><h2>Service health</h2><p>Live state reported by the control plane.</p></div><ShieldCheck /></div><div className="settings-system-list"><ServiceRow label="Workspace" ready={overview?.workspace.status === "ready"} value={overview?.workspace.status ?? "Checking"} /><ServiceRow label="OpenClaw model" ready={overview?.workspace.openclawModelReady === true} value={overview?.workspace.openclawModelReady ? "Ready" : "Setup required"} /><ServiceRow label="Neural Labs Tools plugin" ready={overview?.mcp.ready === true} value={overview?.mcp.ready ? "Ready" : "Offline"} /></div></section></div>
      <section className="settings-card settings-about-links"><a href="https://github.com/Alshival-Ai/neural-labs/tree/main/wiki" target="_blank" rel="noreferrer"><FileText /><span><strong>Documentation</strong><small>Architecture, operations, and guides</small></span><ExternalLink /></a><a href="https://github.com/Alshival-Ai/neural-labs/blob/main/wiki/adr/0003-shared-developer-workspace.md" target="_blank" rel="noreferrer"><KeyRound /><span><strong>Security notes</strong><small>Trust boundaries and shared access</small></span><ExternalLink /></a><a href="https://openclaw.ai" target="_blank" rel="noreferrer"><Bot /><span><strong>OpenClaw</strong><small>The agent runtime underneath Neura</small></span><ExternalLink /></a></section>
      <p className="settings-about-footer">Neural Labs · Built with care by Alshival.Ai</p>
    </div>
  );
}

function ToggleRow({ label, description, checked, disabled = false, onChange }: { label: string; description: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className={`settings-toggle${disabled ? " is-disabled" : ""}`}><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

function SettingsField({ label, hint, wide = false, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? "settings-field-wide" : undefined}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

async function copyValue(value: string, onCopied: () => void) {
  await navigator.clipboard.writeText(value);
  onCopied();
}

function CopyField({ label, value, onCopied }: { label: string; value: string | null; onCopied: () => void }) {
  if (!value) return null;
  return <div className="settings-copy-field"><div><span>{label}</span><code>{value}</code></div><button type="button" onClick={() => void copyValue(value, onCopied)}><Clipboard />Copy</button></div>;
}
