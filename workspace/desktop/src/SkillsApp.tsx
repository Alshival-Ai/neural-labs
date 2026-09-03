import {
  BadgeCheck, Blocks, Bot, Check, ChevronLeft, ChevronRight, CircleAlert, CircleCheck,
  CalendarClock, CloudDownload, Code2, CopyPlus, FileCode2, Folder, Globe2, KeyRound, LockKeyhole, PackageSearch,
  Plus, RefreshCw, Search, ShieldAlert, Sparkles, TerminalSquare, Upload, UserRound,
  Users, Wrench, X, type LucideIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { CustomSkillDraft } from "./skillsApi";
import "./skills-app.css";

export type SkillAccent = "cyan" | "violet" | "pink" | "coral" | "amber" | "mint";
export type SkillSource = "workspace" | "project" | "personal" | "managed" | "bundled" | "plugin" | "node";
export type SkillEligibility = "eligible" | "needs-setup" | "disabled" | "shadowed" | "offline";
export type SkillsSection = "mine" | "team" | "drafts" | "automations" | "openclaw";
export type SkillDraftSummary = { id: string; title: string; kind: "skill" | "automation"; ownerDisplayName: string; updatedAt: string; publishedAt?: string };
export type SkillRequirement = { kind: "os" | "binary" | "environment" | "config" | "node"; label: string; value: string; state: "met" | "missing" | "info" };
export type SkillRevision = { id: string; label: string; author: string; time: string; active?: boolean; note: string };

export type SkillRecord = {
  id: string; key: string; name: string; description: string; emoji: string; accent: SkillAccent;
  source: SkillSource; scope: "workspace" | "personal" | "team" | "system"; owner: string; path: string;
  enabled: boolean; eligibility: SkillEligibility; eligibilityNote: string; userInvocable: boolean;
  modelInvocable: boolean; command?: string; directTool?: string; writable: boolean; workshopOwned?: boolean;
  shared?: boolean; custom?: boolean; editable?: boolean; ownedByCurrentUser?: boolean; overrides?: string; node?: string;
  agents: readonly string[]; useCount: number; lastUsed: string; requirements: readonly SkillRequirement[];
  files: readonly { name: string; size: string; kind: "instruction" | "reference" | "script" }[];
  revisions: readonly SkillRevision[]; instructions: string;
  instructionsState?: "idle" | "loading" | "loaded" | "error";
  instructionsError?: string;
};

// Compatibility types for the Gateway adapter. Workshop still exists in
// OpenClaw, but ordinary Neural Labs skill creation no longer uses it.
export type SkillProposalStatus = "pending" | "stale" | "applied" | "rejected" | "quarantined";
export type SkillProposalAction = "evaluate" | "apply" | "request-revision" | "reject" | "quarantine";
export type SkillProposal = {
  id: string; title: string; kind: "create" | "update"; status: SkillProposalStatus; target: string;
  author: string; updated: string; goal: string; evidence: string;
  scanner: { decision: "pass" | "warning" | "blocked"; critical: number; warnings: number; summary: string };
  draftHash: string; revisionHash?: string; targetHash?: string; supportFiles: readonly string[]; instructions: string;
};
export type SkillProposalDraft = {
  kind: "create" | "update"; target?: string; name: string; description: string; goal: string; instructions: string;
  scope: "workspace" | "team"; userInvocable: boolean; modelInvocable: boolean;
};

export type ClawHubResult = {
  id: string; slug: string; installRef: string; name: string; description: string; emoji: string;
  accent: SkillAccent; owner: string; official?: boolean; version: string; updated: string;
  security: "passed" | "warning" | "unscanned"; securityNote: string; tags: readonly string[];
  requirements: string; changelog: string; installOnly?: boolean;
};

export type SkillsAppProps = {
  skills?: readonly SkillRecord[]; clawHubResults?: readonly ClawHubResult[]; workspaceName?: string;
  currentUserName?: string; gatewayOnline?: boolean; canInstallFromOpenClaw?: boolean; loading?: boolean; error?: string;
  onRefresh?: () => void | Promise<void>; onSelectSkill?: (skill: SkillRecord) => void | Promise<void>;
  onSelectHub?: (result: ClawHubResult) => void | Promise<void>; onDiscoverSearch?: (query: string) => void | Promise<void>;
  onInvoke?: (skill: SkillRecord) => void | Promise<void>;
  onSave?: (draft: CustomSkillDraft, skill?: SkillRecord) => void | Promise<void>;
  onShare?: (skill: SkillRecord, scope: "personal" | "team") => void | Promise<void>;
  onInstall?: (result: ClawHubResult) => void | Promise<void>;
  drafts?: readonly SkillDraftSummary[]; automationsContent?: ReactNode; initialSection?: SkillsSection; sectionRequestId?: string;
  onCreateSkill?: () => void; onCreateAutomation?: () => void; onOpenDraft?: (draft: SkillDraftSummary) => void;
  onEditSkill?: (skill: SkillRecord) => void; onDuplicateSkill?: (skill: SkillRecord) => void;
};

export const PLACEHOLDER_SKILLS: readonly SkillRecord[] = [
  {
    id: "customer-handoff", key: "customer-handoff", name: "Customer handoff",
    description: "Turn solved customer work into a concise engineering handoff.", emoji: "✦", accent: "violet",
    source: "personal", scope: "personal", owner: "You", path: "~/.agents/skills/customer-handoff/SKILL.md",
    enabled: true, eligibility: "eligible", eligibilityNote: "Ready in your Neura skill picker.",
    userInvocable: true, modelInvocable: false, command: "$customer-handoff", writable: true, custom: true,
    editable: true, ownedByCurrentUser: true, shared: false, agents: ["Neura"], useCount: 4, lastUsed: "Yesterday",
    requirements: [], files: [{ name: "SKILL.md", size: "1.2 KB", kind: "instruction" }], revisions: [],
    instructions: "# Customer handoff\n\nCapture the impact, shortest reproduction, evidence, workaround, and owner.",
  },
  {
    id: "release-notes", key: "release-notes", name: "Release notes",
    description: "Turn merged work into crisp, audience-aware release notes.", emoji: "◎", accent: "cyan",
    source: "workspace", scope: "team", owner: "Platform team", path: "<workspace>/skills/release-notes/SKILL.md",
    enabled: true, eligibility: "eligible", eligibilityNote: "Available to everyone in the workspace.",
    userInvocable: true, modelInvocable: true, command: "$release-notes", writable: true, custom: true,
    editable: true, shared: true, agents: ["Neura"], useCount: 38, lastUsed: "12 min ago", requirements: [],
    files: [{ name: "SKILL.md", size: "4.2 KB", kind: "instruction" }], revisions: [],
    instructions: "# Release notes\n\nGroup merged work by customer outcome and preserve useful links.",
  },
  {
    id: "github", key: "github", name: "GitHub", description: "Inspect issues, pull requests, checks, and repositories.",
    emoji: "◇", accent: "pink", source: "bundled", scope: "system", owner: "OpenClaw",
    path: "bundled/skills/github/SKILL.md", enabled: true, eligibility: "eligible", eligibilityNote: "Built into OpenClaw and ready.",
    userInvocable: true, modelInvocable: true, command: "$github", writable: false, shared: true, agents: ["Neura"],
    useCount: 24, lastUsed: "3 hr ago", requirements: [{ kind: "binary", label: "GitHub CLI", value: "gh", state: "met" }],
    files: [{ name: "SKILL.md", size: "Built in", kind: "instruction" }], revisions: [], instructions: "# GitHub\n\nUse the GitHub CLI to inspect repository work.",
  },
  {
    id: "image-lab", key: "image-lab", name: "Image lab", description: "Create image concepts from a written brief.",
    emoji: "◌", accent: "amber", source: "workspace", scope: "team", owner: "Design team",
    path: "<workspace>/skills/image-lab/SKILL.md", enabled: true, eligibility: "needs-setup", eligibilityNote: "Missing IMAGE_PROVIDER_API_KEY.",
    userInvocable: true, modelInvocable: true, command: "$image-lab", writable: true, custom: true, editable: true,
    shared: true, agents: ["Neura"], useCount: 0, lastUsed: "Never",
    requirements: [{ kind: "environment", label: "Image provider", value: "IMAGE_PROVIDER_API_KEY", state: "missing" }],
    files: [{ name: "SKILL.md", size: "1.1 KB", kind: "instruction" }], revisions: [], instructions: "# Image lab\n\nCreate visual concepts from a written brief.",
  },
];

export const PLACEHOLDER_CLAWHUB_RESULTS: readonly ClawHubResult[] = [
  { id: "meeting-notes", slug: "openclaw/meeting-notes", installRef: "openclaw/meeting-notes@2.4.1", name: "Meeting notes", description: "Turn transcripts into decisions, owners, and follow-ups.", emoji: "✦", accent: "cyan", owner: "@openclaw", official: true, version: "2.4.1", updated: "Updated 2 days ago", security: "passed", securityNote: "Official OpenClaw publisher.", tags: ["meetings", "notes"], requirements: "No extra setup", changelog: "Improved action-owner extraction." },
  { id: "data-cleanup", slug: "labs/data-cleanup", installRef: "labs/data-cleanup@1.1.0", name: "Data cleanup", description: "Profile tabular data and propose reversible cleanup steps.", emoji: "▦", accent: "mint", owner: "@labs", version: "1.1.0", updated: "Updated yesterday", security: "unscanned", securityNote: "This version has not been scanned by ClawHub.", tags: ["data", "csv"], requirements: "Requires python3", changelog: "Adds duplicate-cluster suggestions." },
];

const NAVIGATION: readonly { id: SkillsSection; label: string; description: string; icon: LucideIcon; accent: SkillAccent }[] = [
  { id: "mine", label: "My Skills", description: "Made and used by you", icon: UserRound, accent: "violet" },
  { id: "team", label: "Team Skills", description: "Shared with everyone", icon: Users, accent: "cyan" },
  { id: "drafts", label: "Drafts", description: "Live collaborative work", icon: FileCode2, accent: "pink" },
  { id: "automations", label: "Automations", description: "Schedules and run history", icon: CalendarClock, accent: "mint" },
  { id: "openclaw", label: "OpenClaw", description: "Built-in and discover", icon: Blocks, accent: "amber" },
];
const SOURCE_LABELS: Record<SkillSource, string> = { workspace: "Team", project: "Project", personal: "Personal", managed: "OpenClaw", bundled: "OpenClaw", plugin: "OpenClaw plugin", node: "OpenClaw node" };
const REQUIREMENT_ICONS: Record<SkillRequirement["kind"], LucideIcon> = { os: Code2, binary: TerminalSquare, environment: KeyRound, config: Wrench, node: Bot };
const STATUS_COPY: Record<SkillEligibility, string> = { eligible: "Ready", "needs-setup": "Needs setup", disabled: "Disabled", shadowed: "Not available", offline: "Offline" };

function cloneSkills(skills: readonly SkillRecord[]) { return skills.map((skill) => ({ ...skill, agents: [...skill.agents], requirements: skill.requirements.map((item) => ({ ...item })), files: skill.files.map((item) => ({ ...item })), revisions: skill.revisions.map((item) => ({ ...item })) })); }
function securityIcon(security: ClawHubResult["security"]) { return security === "passed" ? CircleCheck : security === "warning" ? ShieldAlert : CircleAlert; }
function renderedSkillInstructions(source: string) {
  if (!source.startsWith("---\n")) return source;
  const end = source.indexOf("\n---\n", 4);
  return end < 0 ? source : source.slice(end + 5).trimStart();
}

export function SkillsApp({ skills = PLACEHOLDER_SKILLS, clawHubResults = PLACEHOLDER_CLAWHUB_RESULTS, workspaceName = "Workspace", currentUserName = "You", gatewayOnline = true, canInstallFromOpenClaw = true, loading = false, error, onRefresh, onSelectSkill, onSelectHub, onDiscoverSearch, onInvoke, onSave, onShare, onInstall, drafts = [], automationsContent, initialSection = "mine", sectionRequestId, onCreateSkill, onCreateAutomation, onOpenDraft, onEditSkill, onDuplicateSkill }: SkillsAppProps) {
  const [section, setSection] = useState<SkillsSection>(initialSection);
  const [localSkills, setLocalSkills] = useState(() => cloneSkills(skills));
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [selectedHubId, setSelectedHubId] = useState("");
  const [query, setQuery] = useState("");
  const [hubQuery, setHubQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSkill, setEditorSkill] = useState<SkillRecord>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const searchTimer = useRef<number | undefined>(undefined);

  useEffect(() => { setLocalSkills(cloneSkills(skills)); }, [skills]);
  useEffect(() => { setSection(initialSection); }, [initialSection, sectionRequestId]);
  useEffect(() => {
    if (!onDiscoverSearch) return;
    window.clearTimeout(searchTimer.current);
    const normalized = hubQuery.trim();
    searchTimer.current = window.setTimeout(() => void Promise.resolve(onDiscoverSearch(normalized)).catch(() => undefined), normalized ? 350 : 0);
    return () => window.clearTimeout(searchTimer.current);
  }, [hubQuery, onDiscoverSearch]);

  const groups = useMemo(() => ({
    mine: localSkills.filter((skill) => skill.scope === "personal" && skill.ownedByCurrentUser),
    team: localSkills.filter((skill) => skill.scope === "team" || skill.scope === "workspace"),
    openclaw: localSkills.filter((skill) => skill.scope === "system" || (!skill.custom && !skill.ownedByCurrentUser && skill.scope === "personal")),
  }), [localSkills]);
  const visibleSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = section === "mine" ? groups.mine : section === "team" ? groups.team : section === "openclaw" ? groups.openclaw : [];
    return rows.filter((skill) => !normalized || `${skill.name} ${skill.description} ${skill.key}`.toLowerCase().includes(normalized));
  }, [groups, query, section]);
  const selectedSkill = visibleSkills.find((skill) => skill.id === selectedSkillId) ?? visibleSkills[0];
  const selectedHub = clawHubResults.find((result) => result.id === selectedHubId) ?? clawHubResults[0];
  const readyCount = localSkills.filter((skill) => skill.enabled && skill.eligibility === "eligible").length;

  const navigate = (next: SkillsSection) => { setSection(next); setQuery(""); setSelectedSkillId(""); setMobileDetail(false); setNotice(undefined); };
  useEffect(() => {
    if (!selectedSkill || selectedSkill.custom || selectedSkill.instructions || selectedSkill.instructionsState === "loading" || selectedSkill.instructionsState === "error") return;
    void Promise.resolve(onSelectSkill?.(selectedSkill)).catch(() => undefined);
  }, [onSelectSkill, selectedSkill?.custom, selectedSkill?.id, selectedSkill?.instructions, selectedSkill?.instructionsState]);

  const selectSkill = (skill: SkillRecord) => { setSelectedSkillId(skill.id); setMobileDetail(true); void Promise.resolve(onSelectSkill?.(skill)).catch(() => undefined); };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSave || busy) return;
    const data = new FormData(event.currentTarget);
    const draft: CustomSkillDraft = { name: String(data.get("name") ?? ""), description: String(data.get("description") ?? ""), instructions: String(data.get("instructions") ?? ""), scope: data.get("scope") === "team" ? "team" : "personal" };
    setBusy(true);
    try { await onSave(draft, editorSkill); setEditorOpen(false); setSection(draft.scope === "team" ? "team" : "mine"); setNotice(`${draft.name} is ready ${draft.scope === "team" ? "for the team" : "in your Neura skill picker"}.`); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : "Could not save the skill."); }
    finally { setBusy(false); }
  };
  const changeScope = async (skill: SkillRecord) => {
    if (!onShare || busy) return;
    const scope = skill.scope === "personal" ? "team" : "personal";
    setBusy(true);
    try { await onShare(skill, scope); setNotice(scope === "team" ? `${skill.name} is now a Team Skill.` : `${skill.name} is personal again.`); setSection(scope === "team" ? "team" : "mine"); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : "Could not change who can use this skill."); }
    finally { setBusy(false); }
  };
  const install = async (result: ClawHubResult) => {
    if (!onInstall || busy) return;
    setBusy(true);
    try { await onInstall(result); setNotice(`${result.name} was added to Team Skills.`); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : `Could not install ${result.name}.`); }
    finally { setBusy(false); }
  };

  return <div className="skills-app">
    <header className="skills-toolbar">
      <div className="skills-toolbar__identity"><span><Blocks /></span><div><strong>Skills</strong><small>{workspaceName}</small></div></div>
      <div className="skills-toolbar__agent"><Bot /><span><small>Works with</small><strong>Neura</strong></span></div>
      <div className={`skills-toolbar__gateway${gatewayOnline ? " is-online" : ""}`}><i /><span>{gatewayOnline ? "Synced" : "OpenClaw offline"}</span></div>
      <button type="button" className="skills-icon-button" aria-label="Refresh skills" disabled={busy} onClick={() => void Promise.resolve(onRefresh?.()).then(() => setNotice("Skills refreshed.")).catch(() => undefined)}><RefreshCw /></button>
      {(onCreateSkill || onSave) && <button type="button" className="skills-primary-button" onClick={() => onCreateSkill ? onCreateSkill() : (setEditorSkill(undefined), setEditorOpen(true))}><Plus />{onCreateSkill ? "Skill" : "New skill"}</button>}
      {onCreateAutomation && <button type="button" className="skills-primary-button is-automation" onClick={onCreateAutomation}><Plus /> Automation</button>}
    </header>
    {(loading || error) && <div className={`skills-live-banner${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>{error ? <CircleAlert /> : <RefreshCw />}<span>{error ?? "Syncing skills with OpenClaw…"}</span></div>}
    <div className="skills-shell">
      <aside className="skills-navigation" aria-label="Skills navigation"><div className="skills-navigation__label">Choose a library</div><nav>{NAVIGATION.map((item) => { const Icon = item.icon; const count = item.id === "mine" ? groups.mine.length : item.id === "team" ? groups.team.length : item.id === "drafts" ? drafts.length : item.id === "automations" ? undefined : groups.openclaw.length; return <button key={item.id} type="button" className={`is-${item.accent}`} aria-current={section === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><span><Icon /></span><div><strong>{item.label}</strong><small>{item.description}</small></div>{count !== undefined && <em>{count}</em>}</button>; })}</nav><div className="skills-navigation__scope"><LockKeyhole /><div><strong>Personal by default</strong><span>Your new skills appear only in your Neura picker until you share them.</span></div></div><div className="skills-navigation__footer"><CircleCheck /><span>{readyCount} ready</span></div></aside>
      <main className="skills-main">
        {(section === "mine" || section === "team") && <div className={`skills-library${mobileDetail ? " has-mobile-detail" : ""}`}>
          <aside className="skills-library-list" aria-label={`${section === "mine" ? "My" : "Team"} skill library`}><div className="skills-list-heading"><div><span>{section === "mine" ? "Personal" : workspaceName}</span><strong>{section === "mine" ? `${currentUserName}'s skills` : "Team Skills"}</strong></div></div><label className="skills-search"><Search /><span className="skills-sr-only">Search skills</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills…" /></label><div className="skills-simple-note">{section === "mine" ? "Only these appear in your personal picker." : "Everyone can find and use these."}</div><SkillList skills={visibleSkills} selectedId={selectedSkill?.id} onSelect={selectSkill} empty={section === "mine" ? "Create your first personal skill" : "No Team Skills yet"} /><footer className="skills-library-list__footer"><RefreshCw /><span>Changes apply to new Neura turns</span></footer></aside>
          {selectedSkill ? <SkillDetail skill={selectedSkill} busy={busy} onBack={() => setMobileDetail(false)} onInvoke={() => { onInvoke?.(selectedSkill); setNotice(`${selectedSkill.command ?? `$${selectedSkill.key}`} added to Neura.`); }} onEdit={selectedSkill.editable && (onEditSkill || onSave) ? () => onEditSkill ? onEditSkill(selectedSkill) : (setEditorSkill(selectedSkill), setEditorOpen(true)) : undefined} onDuplicate={!selectedSkill.editable && onDuplicateSkill ? () => onDuplicateSkill(selectedSkill) : undefined} onChangeScope={selectedSkill.custom && selectedSkill.editable && onShare ? () => void changeScope(selectedSkill) : undefined} /> : <EmptyDetail icon={section === "mine" ? UserRound : Users} title={section === "mine" ? "Your own way of working" : "Shared ways of working"} copy={section === "mine" ? "Create a skill and it is ready in Neura—no approval queue." : "Share a personal skill when it becomes useful to everyone."} action={onCreateSkill ?? (onSave ? () => { setEditorSkill(undefined); setEditorOpen(true); } : undefined)} />}
        </div>}
        {section === "drafts" && <div className="skills-drafts"><header><div><span>Collaborative workspace</span><h1>Drafts</h1><p>Autosaved packages and automations. All administrators can inspect every draft.</p></div><button type="button" onClick={onCreateSkill}><Plus /> Skill</button></header><div>{drafts.map((draft) => <button type="button" key={draft.id} onClick={() => onOpenDraft?.(draft)}><span className={`is-${draft.kind}`}>{draft.kind === "skill" ? <Bot /> : <CalendarClock />}</span><div><strong>{draft.title}</strong><small>{draft.kind} · {draft.ownerDisplayName}</small><em>Updated {new Date(draft.updatedAt).toLocaleString()}</em></div><ChevronRight /></button>)}{drafts.length === 0 && <div className="skills-drafts__empty"><FileCode2 /><strong>No drafts yet</strong><span>Create a skill to open the collaborative builder.</span></div>}</div></div>}
        {section === "automations" && <div className="skills-automations-pane">{automationsContent}</div>}
        {section === "openclaw" && <div className="skills-openclaw"><header className="skills-discover-hero"><div className="skills-discover-hero__art"><Globe2 /><Sparkles /><Blocks /></div><div><span>OpenClaw Skills</span><h1>Built in, or ready to add.</h1><p>Use installed OpenClaw skills now, or search ClawHub for more.</p></div><label><Search /><span className="skills-sr-only">Search OpenClaw skills</span><input value={hubQuery} onChange={(event) => setHubQuery(event.target.value)} placeholder="Search ClawHub…" /></label></header>
          {!hubQuery.trim() ? <div className={`skills-openclaw-installed-view${mobileDetail ? " has-mobile-detail" : ""}`}><div className="skills-openclaw-installed"><header><div><span>Already available</span><h2>Installed OpenClaw skills</h2></div><small>{groups.openclaw.length} skills</small></header><div className="skills-installed-grid">{groups.openclaw.map((skill) => <button type="button" key={skill.id} className={`skill-installed-card is-${skill.accent}${selectedSkill?.id === skill.id ? " is-selected" : ""}`} onClick={() => selectSkill(skill)}><span>{skill.emoji}</span><div><strong>{skill.name}</strong><small>{skill.description}</small></div><ChevronRight /></button>)}</div>{groups.openclaw.length === 0 && <div className="skills-openclaw-empty"><PackageSearch /><strong>No installed OpenClaw skills</strong><span>Search ClawHub above to find one.</span></div>}</div>{selectedSkill && <SkillDetail skill={selectedSkill} busy={busy} onBack={() => setMobileDetail(false)} onInvoke={() => { onInvoke?.(selectedSkill); setNotice(`${selectedSkill.command ?? `${selectedSkill.key}`} added to Neura.`); }} onDuplicate={!selectedSkill.editable && onDuplicateSkill ? () => onDuplicateSkill(selectedSkill) : undefined} />}</div> : <div className="skills-discover-body"><div className="skills-hub-results"><header><div><strong>{clawHubResults.length} results</strong><span>From ClawHub</span></div></header><div className="skills-hub-grid">{clawHubResults.map((result) => { const SecurityIcon = securityIcon(result.security); return <button key={result.id} type="button" className={`skill-hub-card is-${result.accent}${selectedHub?.id === result.id ? " is-selected" : ""}`} aria-label={result.name} onClick={() => { setSelectedHubId(result.id); void Promise.resolve(onSelectHub?.(result)).catch(() => undefined); }}><span className="skill-hub-card__mark">{result.emoji}</span><span className="skill-hub-card__title"><strong>{result.name}</strong><small>{result.owner}{result.official && <BadgeCheck />}</small></span><p>{result.description}</p><span className={`skill-hub-card__security is-${result.security}`}><SecurityIcon />{result.official ? "Official" : result.security === "unscanned" ? "Not scanned" : "Review"}</span><span className="skill-hub-card__version">v{result.version}<ChevronRight /></span></button>; })}</div></div>{selectedHub && <aside className={`skill-hub-detail is-${selectedHub.accent}`} aria-label={`${selectedHub.name} OpenClaw details`}><header><span>{selectedHub.emoji}</span><div><small>{selectedHub.slug}</small><h2>{selectedHub.name}</h2><p>{selectedHub.owner}{selectedHub.official ? " · Official" : " · Third-party"}</p></div></header><p className="skill-hub-detail__summary">{selectedHub.description}</p><div className={`skill-hub-verdict is-${selectedHub.security}`}>{(() => { const Icon = securityIcon(selectedHub.security); return <Icon />; })()}<div><strong>{selectedHub.official ? "Official publisher" : "Review before adding"}</strong><span>{selectedHub.securityNote}</span></div></div><dl className="skill-hub-meta"><div><dt>Version</dt><dd>{selectedHub.version}</dd></div><div><dt>Requires</dt><dd>{selectedHub.requirements}</dd></div></dl><section><span>What changed</span><p>{selectedHub.changelog}</p></section>{!selectedHub.official && <p className="skill-hub-detail__caution"><ShieldAlert /> Third-party skills contain instructions. Review their source before installing.</p>}<footer><button type="button" className="is-install" disabled={!canInstallFromOpenClaw || !onInstall || busy} onClick={() => void install(selectedHub)}><CloudDownload />{canInstallFromOpenClaw ? "Add to Team Skills" : "Admin install"}</button></footer></aside>}</div>}
        </div>}
      </main>
    </div>
    {notice && <div className="skills-notice" role="status"><Check /><span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice(undefined)}><X /></button></div>}
    {editorOpen && onSave && <SkillEditor skill={editorSkill} busy={busy} workspaceName={workspaceName} onClose={() => setEditorOpen(false)} onSubmit={save} />}
  </div>;
}

function SkillList({ skills, selectedId, onSelect, empty }: { skills: readonly SkillRecord[]; selectedId?: string; onSelect: (skill: SkillRecord) => void; empty: string }) {
  return <div className="skills-list-scroll">{skills.map((skill) => <button key={skill.id} type="button" className={`skill-list-item is-${skill.accent}${selectedId === skill.id ? " is-selected" : ""}`} aria-label={skill.name} onClick={() => onSelect(skill)}><span className="skill-list-item__mark">{skill.emoji}</span><span className="skill-list-item__copy"><strong>{skill.name}</strong><small>{SOURCE_LABELS[skill.source]} · {skill.command ?? "automatic"}</small><em className={`is-${skill.eligibility}`}><i />{STATUS_COPY[skill.eligibility]}</em></span><ChevronRight /></button>)}{skills.length === 0 && <div className="skills-list-empty"><Sparkles /><strong>{empty}</strong><span>Use New skill to get started.</span></div>}</div>;
}

function SkillDetail({ skill, busy, onBack, onInvoke, onEdit, onDuplicate, onChangeScope }: { skill: SkillRecord; busy: boolean; onBack: () => void; onInvoke: () => void; onEdit?: () => void; onDuplicate?: () => void; onChangeScope?: () => void }) {
  const instructionsPending = !skill.instructions.trim() && skill.instructionsState !== "error";
  return <section className={`skill-detail is-${skill.accent}`} aria-label={`${skill.name} details`}><header className="skill-detail-header"><button type="button" className="skill-detail-header__back" aria-label="Back to skill library" onClick={onBack}><ChevronLeft /></button><span className="skill-detail-header__mark">{skill.emoji}</span><div className="skill-detail-header__copy"><span>{skill.scope === "personal" ? "My skill" : "Team skill"}</span><h1>{skill.name}</h1><p>{skill.description}</p></div><div className="skill-detail-header__actions"><button type="button" className="skill-invoke" disabled={!skill.enabled || skill.eligibility !== "eligible"} onClick={onInvoke}><Sparkles /> Use in Neura</button>{onEdit && <button type="button" aria-label={`Edit ${skill.name}`} onClick={onEdit}><FileCode2 /></button>}{onDuplicate && <button type="button" aria-label={`Duplicate ${skill.name}`} onClick={onDuplicate}><CopyPlus /></button>}</div></header>{skill.eligibility !== "eligible" && <div className={`skill-status-banner is-${skill.eligibility}`}><CircleAlert /><div><strong>{STATUS_COPY[skill.eligibility]}</strong><span>{skill.eligibilityNote}</span></div></div>}<div className="skill-simple-detail"><section className="skill-simple-card is-about"><span>What it does</span><h2>{skill.description}</h2><div className="skill-invocation-command"><code>{skill.command ?? `$${skill.key}`}</code><button type="button" onClick={() => void navigator.clipboard?.writeText(skill.command ?? `$${skill.key}`)}>Copy</button></div></section><section className="skill-simple-card"><span>Who can use it</span><h2>{skill.scope === "personal" ? "Just you" : "Everyone on the team"}</h2><p>{skill.scope === "personal" ? "It appears in your Neura picker. Other users can inspect the shared environment, but it is not offered to their agents by default." : "Neura can use it for anyone in this workspace."}</p>{onChangeScope && <button type="button" className="skill-share-button" disabled={busy} onClick={onChangeScope}>{skill.scope === "personal" ? <Users /> : <LockKeyhole />}{skill.scope === "personal" ? "Share with team" : "Make personal"}</button>}</section><section className="skill-simple-card"><span>Status</span><h2>{STATUS_COPY[skill.eligibility]}</h2><p>{skill.eligibilityNote}</p>{skill.requirements.length > 0 && <div className="skill-requirements">{skill.requirements.map((requirement) => { const Icon = REQUIREMENT_ICONS[requirement.kind]; return <div key={`${requirement.kind}-${requirement.value}`} className={`is-${requirement.state}`}><Icon /><span><small>{requirement.label}</small><strong>{requirement.value}</strong></span>{requirement.state === "met" ? <Check /> : <CircleAlert />}</div>; })}</div>}</section><section className="skill-simple-card is-instructions"><span>Instructions</span><div className="skill-markdown-document" role="region" aria-label={`${skill.name} Markdown instructions`} aria-busy={instructionsPending}><header><code>SKILL.md</code><small>Rendered Markdown</small></header><article>{skill.instructions.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{renderedSkillInstructions(skill.instructions)}</ReactMarkdown> : skill.instructionsState === "error" ? <p className="skill-markdown-error"><CircleAlert />{skill.instructionsError ?? "The SKILL.md instructions could not be read."}</p> : <p className="skill-markdown-loading"><RefreshCw /> Loading SKILL.md…</p>}</article></div></section><section className="skill-simple-meta"><Folder /><span><strong>{skill.owner}</strong><small>{skill.path}</small></span></section></div></section>;
}

function EmptyDetail({ icon: Icon, title, copy, action }: { icon: LucideIcon; title: string; copy: string; action?: () => void }) { return <section className="skill-empty-detail"><Icon /><h1>{title}</h1><p>{copy}</p>{action && <button type="button" onClick={action}><Plus /> Create a skill</button>}</section>; }

function SkillEditor({ skill, busy, workspaceName, onClose, onSubmit }: { skill?: SkillRecord; busy: boolean; workspaceName: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="skill-composer-layer"><button type="button" className="skill-composer-scrim" aria-label="Close skill editor" onClick={onClose} /><aside className="skill-composer" aria-label={skill ? `Edit ${skill.name}` : "Create a skill"}><header><div className="skill-composer__mark"><Sparkles /></div><div><span>{skill ? "Edit skill" : "New skill"}</span><h2>{skill?.name ?? "Teach Neura something useful"}</h2><p>Saves immediately. No approval queue.</p></div><button type="button" aria-label="Close skill editor" onClick={onClose}><X /></button></header><form key={skill?.id ?? "new"} onSubmit={onSubmit}><section><div className="skill-form-heading"><span>1</span><div><strong>Name it</strong><small>Describe one clear capability.</small></div></div><label><span>Name</span><input name="name" required maxLength={80} readOnly={Boolean(skill)} defaultValue={skill?.name ?? ""} placeholder="Customer handoff" /></label><label><span>What it helps with</span><textarea name="description" required maxLength={500} rows={2} defaultValue={skill?.description ?? ""} placeholder="Turn solved customer work into a concise handoff." /></label></section><section><div className="skill-form-heading"><span>2</span><div><strong>Give Neura instructions</strong><small>Write the reusable steps, rules, and expected output.</small></div></div><label><span>Instructions</span><textarea className="is-code" name="instructions" required rows={12} defaultValue={skill?.instructions ?? "# Skill name\n\nExplain when to use this skill and what Neura should do."} /></label></section><section><div className="skill-form-heading"><span>3</span><div><strong>Who should get it?</strong><small>You can change this later.</small></div></div><div className="skill-form-choice"><label><input type="radio" name="scope" value="personal" defaultChecked={!skill || skill.scope === "personal"} /><span><LockKeyhole /><strong>Just me</strong><small>In your Neura picker</small></span></label><label><input type="radio" name="scope" value="team" defaultChecked={skill?.scope === "team" || skill?.scope === "workspace"} /><span><Users /><strong>{workspaceName} team</strong><small>Available to everyone</small></span></label></div><p className="skill-form-help"><ShieldAlert /> Never put passwords, keys, or customer secrets in a skill.</p></section><footer><p><CircleCheck /> Ready as soon as it saves</p><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={busy}><Upload />{busy ? "Saving…" : "Save skill"}</button></footer></form></aside></div>;
}
