import {
  ArchiveRestore,
  BadgeCheck,
  Blocks,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CloudDownload,
  Code2,
  FileCode2,
  FileText,
  Folder,
  Globe2,
  History,
  KeyRound,
  LibraryBig,
  LockKeyhole,
  PackageSearch,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Upload,
  Users,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import "./skills-app.css";

export type SkillAccent = "cyan" | "violet" | "pink" | "coral" | "amber" | "mint";
export type SkillSource = "workspace" | "project" | "personal" | "managed" | "bundled" | "plugin" | "node";
export type SkillEligibility = "eligible" | "needs-setup" | "disabled" | "shadowed" | "offline";
export type SkillsSection = "library" | "workshop" | "discover";
export type SkillFilter = "all" | "ready" | "attention" | "shared";

export type SkillRequirement = {
  kind: "os" | "binary" | "environment" | "config" | "node";
  label: string;
  value: string;
  state: "met" | "missing" | "info";
};

export type SkillRevision = {
  id: string;
  label: string;
  author: string;
  time: string;
  active?: boolean;
  note: string;
};

export type SkillRecord = {
  id: string;
  key: string;
  name: string;
  description: string;
  emoji: string;
  accent: SkillAccent;
  source: SkillSource;
  scope: "workspace" | "personal" | "team" | "system";
  owner: string;
  path: string;
  enabled: boolean;
  eligibility: SkillEligibility;
  eligibilityNote: string;
  userInvocable: boolean;
  modelInvocable: boolean;
  command?: string;
  directTool?: string;
  writable: boolean;
  workshopOwned?: boolean;
  shared?: boolean;
  overrides?: string;
  node?: string;
  agents: readonly string[];
  useCount: number;
  lastUsed: string;
  requirements: readonly SkillRequirement[];
  files: readonly { name: string; size: string; kind: "instruction" | "reference" | "script" }[];
  revisions: readonly SkillRevision[];
  instructions: string;
};

export type SkillProposalStatus = "pending" | "stale" | "applied" | "rejected" | "quarantined";
export type SkillProposalAction = "evaluate" | "apply" | "request-revision" | "reject" | "quarantine";

export type SkillProposal = {
  id: string;
  title: string;
  kind: "create" | "update";
  status: SkillProposalStatus;
  target: string;
  author: string;
  updated: string;
  goal: string;
  evidence: string;
  scanner: { decision: "pass" | "warning" | "blocked"; critical: number; warnings: number; summary: string };
  draftHash: string;
  revisionHash?: string;
  targetHash?: string;
  supportFiles: readonly string[];
  instructions: string;
};

export type ClawHubResult = {
  id: string;
  slug: string;
  installRef: string;
  name: string;
  description: string;
  emoji: string;
  accent: SkillAccent;
  owner: string;
  official?: boolean;
  version: string;
  updated: string;
  security: "passed" | "warning" | "unscanned";
  securityNote: string;
  tags: readonly string[];
  requirements: string;
  changelog: string;
  installOnly?: boolean;
};

export type SkillProposalDraft = {
  kind: "create" | "update";
  target?: string;
  name: string;
  description: string;
  goal: string;
  instructions: string;
  scope: "workspace" | "team";
  userInvocable: boolean;
  modelInvocable: boolean;
};

export type SkillsAppProps = {
  skills?: readonly SkillRecord[];
  proposals?: readonly SkillProposal[];
  clawHubResults?: readonly ClawHubResult[];
  workspaceName?: string;
  gatewayOnline?: boolean;
  canManage?: boolean;
  allowPersonalInstall?: boolean;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void | Promise<void>;
  onSelectSkill?: (skill: SkillRecord) => void | Promise<void>;
  onSelectProposal?: (proposal: SkillProposal) => void | Promise<void>;
  onSelectHub?: (result: ClawHubResult) => void | Promise<void>;
  onDiscoverSearch?: (query: string) => void | Promise<void>;
  onInvoke?: (skill: SkillRecord) => void | Promise<void>;
  onToggle?: (skill: SkillRecord, enabled: boolean) => void | Promise<void>;
  onShare?: (skill: SkillRecord, shared: boolean) => void | Promise<void>;
  onRollback?: (skill: SkillRecord, revision: SkillRevision) => void | Promise<void>;
  onProposalAction?: (proposal: SkillProposal, action: SkillProposalAction) => void | Promise<void>;
  onPropose?: (draft: SkillProposalDraft) => void | Promise<void>;
  onInstall?: (result: ClawHubResult, target: "workspace" | "personal") => void | Promise<void>;
  onScanHistory?: () => void | Promise<void>;
};

// Prototype-only records. Product integration should replace these through props.
export const PLACEHOLDER_SKILLS: readonly SkillRecord[] = [
  {
    id: "release-notes",
    key: "release-notes",
    name: "Release notes",
    description: "Turn merged work into crisp, audience-aware release notes with links and ownership intact.",
    emoji: "✦",
    accent: "cyan",
    source: "workspace",
    scope: "team",
    owner: "Platform team",
    path: "<workspace>/skills/release-notes/SKILL.md",
    enabled: true,
    eligibility: "eligible",
    eligibilityNote: "All requirements are available in this workspace.",
    userInvocable: true,
    modelInvocable: true,
    command: "$release_notes",
    writable: true,
    workshopOwned: true,
    shared: true,
    overrides: "Bundled release-notes",
    agents: ["main", "release", "docs"],
    useCount: 38,
    lastUsed: "12 min ago",
    requirements: [
      { kind: "binary", label: "Git", value: "git", state: "met" },
      { kind: "config", label: "Workspace repository", value: "workspace.repo", state: "met" },
      { kind: "os", label: "Operating system", value: "Any", state: "met" },
    ],
    files: [
      { name: "SKILL.md", size: "4.2 KB", kind: "instruction" },
      { name: "references/style-guide.md", size: "2.8 KB", kind: "reference" },
      { name: "scripts/collect.mjs", size: "1.6 KB", kind: "script" },
    ],
    revisions: [
      { id: "r7", label: "7f2c8a1", author: "Maya Chen", time: "Today · 2:18 PM", active: true, note: "Prefer customer impact over commit chronology." },
      { id: "r6", label: "32bd1e4", author: "Owen Brooks", time: "Aug 29 · 4:40 PM", note: "Added links and ownership rules." },
      { id: "r5", label: "e49ac02", author: "Maya Chen", time: "Aug 24 · 11:12 AM", note: "Initial managed revision." },
    ],
    instructions: `# Release notes\n\nTurn merged work into a concise release narrative for the intended audience.\n\n## Workflow\n1. Read the merged changes and linked decisions.\n2. Group by customer outcome, not commit order.\n3. Preserve useful links and name an owner for follow-up work.\n4. Call out migrations, risk, and rollback notes.\n\nNever invent impact that is not supported by the workspace evidence.`,
  },
  {
    id: "incident-triage",
    key: "incident-triage",
    name: "Incident triage",
    description: "Structure noisy incident context into severity, evidence, immediate action, and owner.",
    emoji: "◎",
    accent: "coral",
    source: "managed",
    scope: "team",
    owner: "Reliability team",
    path: "<state-dir>/skills/incident-triage/revisions/4a91c72",
    enabled: true,
    eligibility: "eligible",
    eligibilityNote: "Pinned revision is healthy and available to three agents.",
    userInvocable: true,
    modelInvocable: true,
    command: "$incident_triage",
    writable: true,
    workshopOwned: true,
    shared: true,
    agents: ["main", "on-call", "release"],
    useCount: 91,
    lastUsed: "2 hr ago",
    requirements: [
      { kind: "config", label: "Incident channel", value: "channels.incidents", state: "met" },
      { kind: "binary", label: "JSON query", value: "jq", state: "met" },
    ],
    files: [
      { name: "SKILL.md", size: "6.1 KB", kind: "instruction" },
      { name: "references/severity.md", size: "3.3 KB", kind: "reference" },
      { name: "templates/update.md", size: "1.1 KB", kind: "reference" },
    ],
    revisions: [
      { id: "r4", label: "4a91c72", author: "Reliability team", time: "Aug 30 · 9:21 AM", active: true, note: "Tighter evidence requirements for severity changes." },
      { id: "r3", label: "0f711d9", author: "Maya Chen", time: "Aug 18 · 1:06 PM", note: "Added stakeholder update template." },
    ],
    instructions: `# Incident triage\n\nEstablish facts before changing severity. Keep a timeline of observed evidence, name the current owner, and propose the smallest reversible action.\n\n## Output\n- Current impact\n- Evidence and unknowns\n- Immediate action\n- Owner and next update`,
  },
  {
    id: "github",
    key: "github",
    name: "GitHub",
    description: "Inspect issues, pull requests, checks, and repositories with consistent collaboration conventions.",
    emoji: "◇",
    accent: "violet",
    source: "bundled",
    scope: "system",
    owner: "OpenClaw",
    path: "bundled/skills/github/SKILL.md",
    enabled: true,
    eligibility: "eligible",
    eligibilityNote: "Bundled skill loaded; GitHub CLI is available.",
    userInvocable: true,
    modelInvocable: true,
    command: "$github",
    directTool: "github",
    writable: false,
    agents: ["main", "release", "docs", "build"],
    useCount: 126,
    lastUsed: "18 min ago",
    requirements: [
      { kind: "binary", label: "GitHub CLI", value: "gh", state: "met" },
      { kind: "environment", label: "Provider authentication", value: "Managed outside the skill", state: "met" },
    ],
    files: [{ name: "SKILL.md", size: "8.7 KB", kind: "instruction" }],
    revisions: [],
    instructions: `# GitHub\n\nUse the GitHub integration to inspect repositories, issues, pull requests, and checks. Preserve source links and ask before taking an externally visible action.`,
  },
  {
    id: "browser-automation",
    key: "browser-automation",
    name: "Browser control",
    description: "Navigate and inspect visible browser state for signed-in workspace flows and local QA.",
    emoji: "◌",
    accent: "pink",
    source: "plugin",
    scope: "workspace",
    owner: "Browser plugin",
    path: "plugins/browser/skills/control-in-app-browser/SKILL.md",
    enabled: true,
    eligibility: "eligible",
    eligibilityNote: "Plugin and browser session are connected.",
    userInvocable: true,
    modelInvocable: true,
    command: "$browser_control",
    directTool: "browser",
    writable: false,
    agents: ["main", "qa"],
    useCount: 44,
    lastUsed: "Yesterday",
    requirements: [{ kind: "config", label: "Plugin", value: "browser.connected", state: "met" }],
    files: [{ name: "SKILL.md", size: "5.4 KB", kind: "instruction" }],
    revisions: [],
    instructions: `# Browser control\n\nUse the in-app browser when visible or interactive page state matters. Prefer semantic operations when a direct integration is available.`,
  },
  {
    id: "image-lab",
    key: "image-lab",
    name: "Image lab",
    description: "Create campaign-ready bitmap concepts from workspace art direction and reusable references.",
    emoji: "✺",
    accent: "amber",
    source: "workspace",
    scope: "workspace",
    owner: "Design team",
    path: "<workspace>/skills/image-lab/SKILL.md",
    enabled: true,
    eligibility: "needs-setup",
    eligibilityNote: "One required environment variable is unavailable to the host turn.",
    userInvocable: true,
    modelInvocable: true,
    command: "$image_lab",
    writable: true,
    agents: ["main", "design"],
    useCount: 7,
    lastUsed: "Aug 26",
    requirements: [
      { kind: "environment", label: "Image provider", value: "IMAGE_PROVIDER_API_KEY", state: "missing" },
      { kind: "binary", label: "Image tools", value: "magick", state: "met" },
      { kind: "config", label: "Output directory", value: "skills.entries.image-lab.output", state: "met" },
    ],
    files: [
      { name: "SKILL.md", size: "3.8 KB", kind: "instruction" },
      { name: "references/art-direction.md", size: "2.3 KB", kind: "reference" },
    ],
    revisions: [],
    instructions: `# Image lab\n\nCreate visual concepts from a written brief. Respect the workspace art direction and keep provider credentials outside of skill files.`,
  },
  {
    id: "mac-window",
    key: "mac-window",
    name: "Mac window control",
    description: "Drive native macOS window actions through a paired desktop node.",
    emoji: "⌁",
    accent: "mint",
    source: "node",
    scope: "personal",
    owner: "Maya Chen",
    path: "node:studio-mac/skills/mac-window/SKILL.md",
    enabled: true,
    eligibility: "offline",
    eligibilityNote: "The node-hosted skill will return when Studio Mac reconnects.",
    userInvocable: true,
    modelInvocable: false,
    command: "$mac_window",
    writable: false,
    node: "Studio Mac · offline",
    agents: ["main"],
    useCount: 14,
    lastUsed: "Aug 28",
    requirements: [
      { kind: "os", label: "Operating system", value: "darwin", state: "met" },
      { kind: "node", label: "Paired node", value: "Studio Mac · offline", state: "missing" },
    ],
    files: [{ name: "SKILL.md", size: "2.9 KB", kind: "instruction" }],
    revisions: [],
    instructions: `# Mac window control\n\nUse the paired macOS node to focus, position, and inspect native application windows. This skill is explicit-invocation only.`,
  },
  {
    id: "coding-agent",
    key: "coding-agent",
    name: "Coding agent",
    description: "Delegate bounded implementation work to an isolated coding agent with repository context.",
    emoji: "›_",
    accent: "cyan",
    source: "bundled",
    scope: "system",
    owner: "OpenClaw",
    path: "bundled/skills/coding-agent/SKILL.md",
    enabled: false,
    eligibility: "disabled",
    eligibilityNote: "Disabled in workspace skill configuration.",
    userInvocable: true,
    modelInvocable: false,
    command: "$coding_agent",
    writable: false,
    agents: ["main"],
    useCount: 3,
    lastUsed: "Aug 19",
    requirements: [{ kind: "binary", label: "Coding runtime", value: "codex", state: "met" }],
    files: [{ name: "SKILL.md", size: "7.8 KB", kind: "instruction" }],
    revisions: [],
    instructions: `# Coding agent\n\nDelegate concrete implementation work with a bounded scope and clear verification requirements. Explicit invocation is required.`,
  },
];

export const PLACEHOLDER_SKILL_PROPOSALS: readonly SkillProposal[] = [
  {
    id: "proposal-release-quality",
    title: "Sharpen release-note quality",
    kind: "update",
    status: "pending",
    target: "release-notes",
    author: "Workshop collection review",
    updated: "8 min ago",
    goal: "Reduce chronological summaries and lead with customer-visible outcomes.",
    evidence: "Five recent uses required a follow-up edit to move implementation detail below the outcome.",
    scanner: { decision: "pass", critical: 0, warnings: 0, summary: "No unsafe instructions, secret patterns, or executable surprises found." },
    draftHash: "9b20f7c",
    targetHash: "7f2c8a1",
    supportFiles: ["references/examples.md"],
    instructions: `# Release notes\n\nLead with the user-visible outcome. Group evidence by outcome, not commit chronology. Preserve links, migrations, risk, and owners.\n\nBefore finishing, remove internal implementation detail that does not help the intended audience act.`,
  },
  {
    id: "proposal-support-handoff",
    title: "Create support handoff",
    kind: "create",
    status: "pending",
    target: "support-handoff",
    author: "Jordan Lee",
    updated: "42 min ago",
    goal: "Turn solved customer threads into a reusable engineering handoff.",
    evidence: "Three substantial sessions repeated the same reproduction, evidence, and ownership structure.",
    scanner: { decision: "warning", critical: 0, warnings: 1, summary: "One shell example needs an operator review before apply." },
    draftHash: "511ed8a",
    supportFiles: ["templates/handoff.md"],
    instructions: `# Support handoff\n\nCapture the customer impact, shortest reproduction, observed evidence, workarounds, and the named engineering owner.`,
  },
  {
    id: "proposal-incident-stale",
    title: "Add stakeholder cadence",
    kind: "update",
    status: "stale",
    target: "incident-triage",
    author: "Maya Chen",
    updated: "Yesterday",
    goal: "Make the next stakeholder update explicit in every incident pass.",
    evidence: "The target changed after this proposal was evaluated.",
    scanner: { decision: "pass", critical: 0, warnings: 0, summary: "Scanner passed, but the target hash no longer matches." },
    draftHash: "7162e0b",
    targetHash: "0f711d9",
    supportFiles: [],
    instructions: `# Incident triage\n\nAlways name the time and owner for the next stakeholder update.`,
  },
  {
    id: "proposal-deploy-check",
    title: "Deployment preflight",
    kind: "create",
    status: "applied",
    target: "deployment-preflight",
    author: "Release team",
    updated: "Aug 28",
    goal: "Standardize the evidence required before a production promotion.",
    evidence: "Applied as immutable revision 88bc912.",
    scanner: { decision: "pass", critical: 0, warnings: 0, summary: "Applied after evaluator approval." },
    draftHash: "88bc912",
    supportFiles: ["references/checklist.md"],
    instructions: `# Deployment preflight\n\nVerify checks, migrations, monitoring, ownership, and rollback before promotion.`,
  },
];

export const PLACEHOLDER_CLAWHUB_RESULTS: readonly ClawHubResult[] = [
  {
    id: "clawhub-meeting-notes",
    slug: "openclaw/meeting-notes",
    installRef: "openclaw/meeting-notes@2.4.1",
    name: "Meeting notes",
    description: "Turn raw transcripts into decisions, owners, risks, and follow-up work without losing the source context.",
    emoji: "✎",
    accent: "violet",
    owner: "@openclaw",
    official: true,
    version: "2.4.1",
    updated: "Updated 3 days ago",
    security: "passed",
    securityNote: "ClawHub scan passed for this version.",
    tags: ["productivity", "writing", "team"],
    requirements: "No external binaries",
    changelog: "Adds decision confidence and clearer unresolved-question handling.",
  },
  {
    id: "clawhub-api-review",
    slug: "community/api-review",
    installRef: "community/api-review@1.8.0",
    name: "API review",
    description: "Review an API change for compatibility, error semantics, examples, and migration impact.",
    emoji: "{·}",
    accent: "cyan",
    owner: "@community",
    version: "1.8.0",
    updated: "Updated last week",
    security: "passed",
    securityNote: "Automated scan passed. Third-party instructions still require review.",
    tags: ["engineering", "api", "review"],
    requirements: "Requires git",
    changelog: "Includes streaming and pagination review prompts.",
  },
  {
    id: "clawhub-campaign-brief",
    slug: "studio/campaign-brief",
    installRef: "studio/campaign-brief@0.9.3",
    name: "Campaign brief",
    description: "Develop a focused campaign direction from positioning, audience evidence, and channel constraints.",
    emoji: "✺",
    accent: "pink",
    owner: "@studio",
    version: "0.9.3",
    updated: "Updated 2 weeks ago",
    security: "warning",
    securityNote: "Review requested: an installer fetches an optional font package.",
    tags: ["marketing", "creative", "planning"],
    requirements: "Optional font installer",
    changelog: "New channel adaptation reference cards.",
  },
  {
    id: "clawhub-data-cleanup",
    slug: "labs/data-cleanup",
    installRef: "labs/data-cleanup@1.1.0",
    name: "Data cleanup",
    description: "Profile a tabular dataset and propose reversible normalization steps before changing it.",
    emoji: "▦",
    accent: "mint",
    owner: "@labs",
    version: "1.1.0",
    updated: "Updated yesterday",
    security: "unscanned",
    securityNote: "This version has not been scanned by ClawHub.",
    tags: ["data", "analysis", "csv"],
    requirements: "Requires python3",
    changelog: "Adds duplicate-cluster suggestions.",
  },
];

const NAVIGATION: readonly { id: SkillsSection; label: string; description: string; icon: LucideIcon; accent: SkillAccent }[] = [
  { id: "library", label: "Library", description: "Effective skills", icon: LibraryBig, accent: "cyan" },
  { id: "workshop", label: "Workshop", description: "Review changes", icon: Wrench, accent: "pink" },
  { id: "discover", label: "Discover", description: "Browse ClawHub", icon: PackageSearch, accent: "amber" },
];

const SOURCE_LABELS: Record<SkillSource, string> = {
  workspace: "Workspace",
  project: "Project agent",
  personal: "Personal",
  managed: "Managed library",
  bundled: "Bundled",
  plugin: "Plugin",
  node: "Node-hosted",
};

const REQUIREMENT_ICONS: Record<SkillRequirement["kind"], LucideIcon> = {
  os: Code2,
  binary: TerminalSquare,
  environment: KeyRound,
  config: Wrench,
  node: Bot,
};

const STATUS_COPY: Record<SkillEligibility, string> = {
  eligible: "Ready",
  "needs-setup": "Needs setup",
  disabled: "Disabled",
  shadowed: "Shadowed",
  offline: "Node offline",
};

function skillMatchesFilter(skill: SkillRecord, filter: SkillFilter) {
  if (filter === "ready") return skill.eligibility === "eligible" && skill.enabled;
  if (filter === "attention") return skill.eligibility !== "eligible" || !skill.enabled;
  if (filter === "shared") return skill.shared || skill.scope === "team";
  return true;
}

function securityIcon(security: ClawHubResult["security"]) {
  if (security === "passed") return ShieldCheck;
  if (security === "warning") return ShieldAlert;
  return CircleAlert;
}

function cloneSkills(skills: readonly SkillRecord[]) {
  return skills.map((skill) => ({
    ...skill,
    agents: [...skill.agents],
    requirements: skill.requirements.map((requirement) => ({ ...requirement })),
    files: skill.files.map((file) => ({ ...file })),
    revisions: skill.revisions.map((revision) => ({ ...revision })),
  }));
}

export function SkillsApp({
  skills = PLACEHOLDER_SKILLS,
  proposals = PLACEHOLDER_SKILL_PROPOSALS,
  clawHubResults = PLACEHOLDER_CLAWHUB_RESULTS,
  workspaceName = "Atlas",
  gatewayOnline = true,
  canManage = true,
  allowPersonalInstall = true,
  loading = false,
  error,
  onRefresh,
  onSelectSkill,
  onSelectProposal,
  onSelectHub,
  onDiscoverSearch,
  onInvoke,
  onToggle,
  onShare,
  onRollback,
  onProposalAction,
  onPropose,
  onInstall,
  onScanHistory,
}: SkillsAppProps) {
  const [section, setSection] = useState<SkillsSection>("library");
  const [localSkills, setLocalSkills] = useState<SkillRecord[]>(() => cloneSkills(skills));
  const [selectedSkillId, setSelectedSkillId] = useState(() => skills[0]?.id ?? "");
  const [selectedProposalId, setSelectedProposalId] = useState(() => proposals[0]?.id ?? "");
  const [selectedHubId, setSelectedHubId] = useState(() => clawHubResults[0]?.id ?? "");
  const [skillFilter, setSkillFilter] = useState<SkillFilter>("all");
  const [skillQuery, setSkillQuery] = useState("");
  const [hubQuery, setHubQuery] = useState("");
  const [detailTab, setDetailTab] = useState<"overview" | "instructions" | "revisions">("overview");
  const [composerOpen, setComposerOpen] = useState(false);
  const [proposalTarget, setProposalTarget] = useState<SkillRecord>();
  const [installTarget, setInstallTarget] = useState<"workspace" | "personal">("workspace");
  const [notice, setNotice] = useState<string>();
  const [mobileDetail, setMobileDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const searchTimer = useRef<number | undefined>(undefined);
  const previousHubQuery = useRef("");

  useEffect(() => {
    setLocalSkills(cloneSkills(skills));
    setSelectedSkillId((current) => skills.some((skill) => skill.id === current) ? current : skills[0]?.id ?? "");
  }, [skills]);

  useEffect(() => {
    setSelectedProposalId((current) => proposals.some((proposal) => proposal.id === current) ? current : proposals[0]?.id ?? "");
  }, [proposals]);

  useEffect(() => {
    setSelectedHubId((current) => clawHubResults.some((result) => result.id === current) ? current : clawHubResults[0]?.id ?? "");
  }, [clawHubResults]);

  useEffect(() => {
    if (!onDiscoverSearch) return;
    window.clearTimeout(searchTimer.current);
    const query = hubQuery.trim();
    if (!query) {
      const hadQuery = Boolean(previousHubQuery.current);
      previousHubQuery.current = "";
      if (hadQuery) void Promise.resolve(onDiscoverSearch("")).catch(() => undefined);
      return;
    }
    previousHubQuery.current = query;
    searchTimer.current = window.setTimeout(() => void Promise.resolve(onDiscoverSearch(query)).catch(() => undefined), 350);
    return () => window.clearTimeout(searchTimer.current);
  }, [hubQuery, onDiscoverSearch]);

  const selectedSkill = localSkills.find((skill) => skill.id === selectedSkillId) ?? localSkills[0];
  const selectedProposal = proposals.find((proposal) => proposal.id === selectedProposalId) ?? proposals[0];
  const selectedHub = clawHubResults.find((result) => result.id === selectedHubId) ?? clawHubResults[0];
  const pendingCount = proposals.filter((proposal) => proposal.status === "pending").length;
  const readyCount = localSkills.filter((skill) => skill.enabled && skill.eligibility === "eligible").length;
  const attentionCount = localSkills.filter((skill) => skill.eligibility !== "eligible" || !skill.enabled).length;
  const sharedCount = localSkills.filter((skill) => skill.shared || skill.scope === "team").length;

  const visibleSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    return localSkills.filter((skill) => {
      const matchesQuery = !query || `${skill.name} ${skill.description} ${skill.key} ${SOURCE_LABELS[skill.source]}`.toLowerCase().includes(query);
      return matchesQuery && skillMatchesFilter(skill, skillFilter);
    });
  }, [localSkills, skillFilter, skillQuery]);

  const visibleHubResults = useMemo(() => {
    const query = hubQuery.trim().toLowerCase();
    return clawHubResults.filter((result) => !query || `${result.name} ${result.description} ${result.slug} ${result.tags.join(" ")}`.toLowerCase().includes(query));
  }, [clawHubResults, hubQuery]);

  const navigate = (next: SkillsSection) => {
    setSection(next);
    setNotice(undefined);
    setMobileDetail(false);
  };

  const selectSkill = (skill: SkillRecord) => {
    setSelectedSkillId(skill.id);
    setDetailTab("overview");
    setMobileDetail(true);
    void Promise.resolve(onSelectSkill?.(skill)).catch(() => undefined);
  };

  const toggleSkill = async (skill: SkillRecord, enabled: boolean) => {
    if (!onToggle || busy) return;
    setBusy(true);
    try {
      await onToggle(skill, enabled);
      setLocalSkills((current) => current.map((item) => item.id === skill.id
        ? { ...item, enabled, eligibility: enabled && item.eligibility === "disabled" ? "eligible" : !enabled ? "disabled" : item.eligibility }
        : item));
      setNotice(`${skill.name} ${enabled ? "enabled" : "disabled"}. New sessions will use the refreshed catalog.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : `Could not update ${skill.name}.`);
    } finally {
      setBusy(false);
    }
  };

  const invokeSkill = (skill: SkillRecord) => {
    onInvoke?.(skill);
    setNotice(`${skill.command ?? `$${skill.key.replaceAll("-", "_")}`} attached to a new Neura message.`);
  };

  const shareSkill = (skill: SkillRecord) => {
    const next = !skill.shared;
    setLocalSkills((current) => current.map((item) => item.id === skill.id ? { ...item, shared: next, scope: next ? "team" : "personal" } : item));
    onShare?.(skill, next);
    setNotice(next ? `${skill.name} is now available to the team.` : `${skill.name} moved back to your personal library.`);
  };

  const proposalAction = async (proposal: SkillProposal, action: SkillProposalAction) => {
    if (!onProposalAction || busy) return;
    setBusy(true);
    const labels: Record<SkillProposalAction, string> = {
      evaluate: "Evaluation requested",
      apply: "Proposal applied as a new immutable revision",
      "request-revision": "Revision requested",
      reject: "Proposal rejected",
      quarantine: "Proposal quarantined",
    };
    try {
      await onProposalAction(proposal, action);
      setNotice(`${labels[action]}: ${proposal.title}.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : `Could not ${action} ${proposal.title}.`);
    } finally {
      setBusy(false);
    }
  };

  const install = async (result: ClawHubResult) => {
    if (!onInstall || busy) return;
    setBusy(true);
    try {
      await onInstall(result, installTarget);
      setNotice(`${result.name} was installed for ${installTarget === "workspace" ? workspaceName : "your personal library"}.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : `Could not install ${result.name}.`);
    } finally {
      setBusy(false);
    }
  };

  const submitProposal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onPropose || busy) return;
    const data = new FormData(event.currentTarget);
    const draft: SkillProposalDraft = {
      kind: proposalTarget ? "update" : "create",
      target: proposalTarget?.key,
      name: String(data.get("name") ?? ""),
      description: String(data.get("description") ?? ""),
      goal: String(data.get("goal") ?? ""),
      instructions: String(data.get("instructions") ?? ""),
      scope: data.get("scope") === "team" ? "team" : "workspace",
      userInvocable: data.get("userInvocable") === "on",
      modelInvocable: data.get("modelInvocable") === "on",
    };
    setBusy(true);
    try {
      await onPropose(draft);
      setComposerOpen(false);
      setSection("workshop");
      setNotice(`${draft.name} ${draft.kind} was added to Workshop as a pending proposal. Nothing live changed.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : `Could not propose ${draft.name}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="skills-app">
      <header className="skills-toolbar">
        <div className="skills-toolbar__identity">
          <span><Blocks /></span>
          <div><strong>Skills</strong><small>{workspaceName} · OpenClaw</small></div>
        </div>
        <div className="skills-toolbar__agent">
          <Bot />
          <span><small>Effective catalog for</small><strong>main agent</strong></span>
          <ChevronRight />
        </div>
        <div className={`skills-toolbar__gateway${gatewayOnline ? " is-online" : ""}`}>
          <i /><span>{gatewayOnline ? "Watcher active" : "Gateway offline"}</span>
        </div>
        <button type="button" className="skills-icon-button" aria-label="Refresh skills" disabled={busy} onClick={() => void Promise.resolve(onRefresh?.()).then(() => setNotice("Skill sources refreshed.")).catch(() => undefined)}><RefreshCw /></button>
        {canManage && onPropose
          ? <button type="button" className="skills-primary-button" onClick={() => { setProposalTarget(undefined); setComposerOpen(true); }}><Plus /> New skill</button>
          : <span className="skills-read-only"><LockKeyhole /> View only</span>}
      </header>

      {(loading || error) && <div className={`skills-live-banner${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>{error ? <CircleAlert /> : <RefreshCw />}<span>{error ?? "Loading the live OpenClaw skill catalog…"}</span></div>}

      <div className="skills-shell">
        <aside className="skills-navigation" aria-label="Skills navigation">
          <div className="skills-navigation__label">Workspace capabilities</div>
          <nav>
            {NAVIGATION.map((item) => {
              const Icon = item.icon;
              const count = item.id === "library" ? localSkills.length : item.id === "workshop" ? pendingCount : undefined;
              return (
                <button key={item.id} type="button" className={`is-${item.accent}`} aria-current={section === item.id ? "page" : undefined} onClick={() => navigate(item.id)}>
                  <span><Icon /></span>
                  <div><strong>{item.label}</strong><small>{item.description}</small></div>
                  {count !== undefined && <em>{count}</em>}
                </button>
              );
            })}
          </nav>
          <div className="skills-navigation__scope">
            <ShieldCheck />
            <div><strong>One trust domain</strong><span>Skills guide agents; they do not grant credentials or new tools.</span></div>
          </div>
          <div className="skills-navigation__footer"><CircleDot /><span>{readyCount} ready for new sessions</span></div>
        </aside>

        <main className="skills-main">
          {section === "library" && (
            <div className={`skills-library${mobileDetail ? " has-mobile-detail" : ""}`}>
              <aside className="skills-library-list" aria-label="Skill library">
                <div className="skills-list-heading">
                  <div><span>Library</span><strong>Effective skills</strong></div>
                </div>
                <label className="skills-search"><Search /><span className="skills-sr-only">Search skills</span><input value={skillQuery} onChange={(event) => setSkillQuery(event.target.value)} placeholder="Search skills…" /></label>
                <div className="skills-filters" aria-label="Filter skills">
                  {(["all", "ready", "attention", "shared"] as const).map((filter) => (
                    <button key={filter} type="button" aria-pressed={skillFilter === filter} onClick={() => setSkillFilter(filter)}>
                      {filter}<span>{filter === "all" ? localSkills.length : filter === "ready" ? readyCount : filter === "attention" ? attentionCount : sharedCount}</span>
                    </button>
                  ))}
                </div>
                <div className="skills-list-scroll">
                  {visibleSkills.map((skill) => (
                    <button key={skill.id} type="button" className={`skill-list-item is-${skill.accent}${selectedSkill?.id === skill.id ? " is-selected" : ""}`} aria-label={skill.name} onClick={() => selectSkill(skill)}>
                      <span className="skill-list-item__mark">{skill.emoji}</span>
                      <span className="skill-list-item__copy">
                        <strong>{skill.name}</strong>
                        <small>{SOURCE_LABELS[skill.source]} · {skill.command ?? "automatic"}</small>
                        <em className={`is-${skill.eligibility}`}><i />{STATUS_COPY[skill.eligibility]}</em>
                      </span>
                      <ChevronRight />
                    </button>
                  ))}
                  {visibleSkills.length === 0 && <div className="skills-list-empty"><Search /><strong>No matching skills</strong><span>Try a different source or status.</span></div>}
                </div>
                <footer className="skills-library-list__footer"><RefreshCw /><span>File watcher updates on the next agent turn</span></footer>
              </aside>

              {selectedSkill && (
                <section className={`skill-detail is-${selectedSkill.accent}`} aria-label={`${selectedSkill.name} details`}>
                  <header className="skill-detail-header">
                    <button type="button" className="skill-detail-header__back" aria-label="Back to skill library" onClick={() => setMobileDetail(false)}><ChevronLeft /></button>
                    <span className="skill-detail-header__mark">{selectedSkill.emoji}</span>
                    <div className="skill-detail-header__copy">
                      <span>{SOURCE_LABELS[selectedSkill.source]} skill</span>
                      <h1>{selectedSkill.name}</h1>
                      <p>{selectedSkill.description}</p>
                    </div>
                    <label className="skill-toggle">
                      <span>{selectedSkill.enabled ? "Enabled" : "Disabled"}</span>
                      <input type="checkbox" aria-label={`Enable ${selectedSkill.name}`} checked={selectedSkill.enabled} disabled={!canManage || !onToggle || busy} onChange={(event) => void toggleSkill(selectedSkill, event.target.checked)} />
                      <i />
                    </label>
                    <div className="skill-detail-header__actions">
                      <button type="button" className="skill-invoke" disabled={!selectedSkill.enabled || selectedSkill.eligibility !== "eligible"} onClick={() => invokeSkill(selectedSkill)}><Sparkles /> Use in Neura</button>
                      {canManage && onPropose && selectedSkill.writable && <button type="button" aria-label={`Edit ${selectedSkill.name}`} onClick={() => { setProposalTarget(selectedSkill); setComposerOpen(true); }}><FileCode2 /></button>}
                    </div>
                  </header>

                  {selectedSkill.eligibility !== "eligible" && (
                    <div className={`skill-status-banner is-${selectedSkill.eligibility}`}>
                      {selectedSkill.eligibility === "needs-setup" || selectedSkill.eligibility === "offline" ? <CircleAlert /> : <CircleDot />}
                      <div><strong>{STATUS_COPY[selectedSkill.eligibility]}</strong><span>{selectedSkill.eligibilityNote}</span></div>
                    </div>
                  )}

                  <div className="skill-detail-tabs" role="tablist" aria-label="Skill details">
                    {(["overview", "instructions", "revisions"] as const).map((tab) => (
                      <button key={tab} type="button" role="tab" aria-selected={detailTab === tab} onClick={() => setDetailTab(tab)}>
                        {tab}{tab === "revisions" && selectedSkill.revisions.length > 0 ? <span>{selectedSkill.revisions.length}</span> : null}
                      </button>
                    ))}
                  </div>

                  <div className="skill-detail-scroll">
                    {detailTab === "overview" && <SkillOverview skill={selectedSkill} onShare={canManage && onShare ? () => shareSkill(selectedSkill) : undefined} />}
                    {detailTab === "instructions" && <SkillInstructions skill={selectedSkill} />}
                    {detailTab === "revisions" && <SkillRevisions skill={selectedSkill} onRollback={(revision) => { onRollback?.(selectedSkill, revision); setNotice(`Rollback requested to ${revision.label}.`); }} />}
                  </div>
                </section>
              )}
            </div>
          )}

          {section === "workshop" && selectedProposal && (
            <div className="skills-workshop">
              <header className="skills-page-heading">
                <div><span>Skill Workshop</span><h1>Teach the workspace safely.</h1><p>Draft, scan, evaluate, and apply. Only apply changes the live library.</p></div>
                <div className="skills-page-heading__actions">
                  {canManage && onScanHistory && <button type="button" disabled={busy} onClick={() => void Promise.resolve(onScanHistory()).then(() => setNotice("Earlier substantial sessions were reviewed.")).catch(() => undefined)}><ScanSearch /> Find skill ideas</button>}
                  {canManage && onPropose && <button type="button" className="is-primary" onClick={() => { setProposalTarget(undefined); setComposerOpen(true); }}><Plus /> New proposal</button>}
                </div>
              </header>
              <div className="skills-workshop-strip">
                <div><Sparkles /><span><small>Collection review</small><strong>Propose changes</strong></span><em>weekly</em></div>
                <p>Usage and last-used evidence can suggest improvements. Workshop never applies a suggestion automatically in this mode.</p>
              </div>
              <div className="skills-workshop-grid">
                <aside className="skills-proposal-list" aria-label="Workshop proposals">
                  <header><div><span>Review queue</span><strong>{pendingCount} pending</strong></div></header>
                  <div>
                    {proposals.map((proposal) => (
                      <button key={proposal.id} type="button" className={selectedProposal.id === proposal.id ? "is-selected" : ""} aria-label={proposal.title} onClick={() => { setSelectedProposalId(proposal.id); void Promise.resolve(onSelectProposal?.(proposal)).catch(() => undefined); }}>
                        <span className={`proposal-kind is-${proposal.kind}`}>{proposal.kind === "create" ? <Plus /> : <RefreshCw />}</span>
                        <span><strong>{proposal.title}</strong><small>{proposal.kind} · {proposal.target}</small><em className={`is-${proposal.status}`}><i />{proposal.status}</em></span>
                        <ChevronRight />
                      </button>
                    ))}
                  </div>
                  <footer><History /> Applied proposals keep revision and rollback history.</footer>
                </aside>
                <section className="skill-proposal-detail" aria-label={`${selectedProposal.title} proposal`}>
                  <header>
                    <div className={`proposal-kind is-${selectedProposal.kind}`}>{selectedProposal.kind === "create" ? <Plus /> : <RefreshCw />}</div>
                    <div><span>{selectedProposal.kind} proposal · {selectedProposal.status}</span><h2>{selectedProposal.title}</h2><p>Target <code>{selectedProposal.target}</code> · {selectedProposal.updated}</p></div>
                  </header>
                  <div className="skill-proposal-detail__scroll">
                    {selectedProposal.status === "stale" && <div className="proposal-alert is-stale"><CircleAlert /><div><strong>Target changed after this proposal was drafted.</strong><span>Revise against the current revision before applying.</span></div></div>}
                    <section className="proposal-intent">
                      <div><span>Goal</span><p>{selectedProposal.goal}</p></div>
                      <div><span>Evidence</span><p>{selectedProposal.evidence}</p></div>
                    </section>
                    <section className={`proposal-scan is-${selectedProposal.scanner.decision}`}>
                      <div className="proposal-scan__mark">{selectedProposal.scanner.decision === "pass" ? <ShieldCheck /> : selectedProposal.scanner.decision === "blocked" ? <ShieldAlert /> : <CircleAlert />}</div>
                      <div><span>Scanner gate</span><h3>{selectedProposal.scanner.decision === "pass" ? "Ready for evaluator review" : selectedProposal.scanner.decision === "blocked" ? "Critical finding blocks apply" : "Review warning before apply"}</h3><p>{selectedProposal.scanner.summary}</p></div>
                      <dl><div><dt>Critical</dt><dd>{selectedProposal.scanner.critical}</dd></div><div><dt>Warnings</dt><dd>{selectedProposal.scanner.warnings}</dd></div></dl>
                    </section>
                    <section className="proposal-draft">
                      <header><div><span>Proposed instructions</span><strong>PROPOSAL.md</strong></div><code>{selectedProposal.draftHash}</code></header>
                      <pre>{selectedProposal.instructions}</pre>
                    </section>
                    <section className="proposal-files">
                      <div><Folder /><span><small>Support files</small><strong>{selectedProposal.supportFiles.length || "No new files"}</strong></span></div>
                      {selectedProposal.supportFiles.map((file) => <code key={file}>{file}</code>)}
                      <div className="proposal-hashes"><span>draft <code>{selectedProposal.draftHash}</code></span>{selectedProposal.targetHash && <span>target <code>{selectedProposal.targetHash}</code></span>}</div>
                    </section>
                  </div>
                  <footer className="proposal-actions">
                    <button type="button" disabled={busy || selectedProposal.status !== "pending" || !onProposalAction} onClick={() => void proposalAction(selectedProposal, "request-revision")}>Request revision</button>
                    <button type="button" disabled={busy || !canManage || selectedProposal.status !== "pending"} onClick={() => void proposalAction(selectedProposal, "reject")}><X /> Reject</button>
                    <button type="button" disabled={busy || !canManage || selectedProposal.status !== "pending"} onClick={() => void proposalAction(selectedProposal, "quarantine")}><ArchiveRestore /> Quarantine</button>
                    <button type="button" disabled={busy || !canManage || selectedProposal.status !== "pending"} onClick={() => void proposalAction(selectedProposal, "evaluate")}><ScanSearch /> Evaluate</button>
                    <button type="button" className="is-apply" disabled={busy || !canManage || selectedProposal.status !== "pending" || selectedProposal.scanner.decision === "blocked"} onClick={() => void proposalAction(selectedProposal, "apply")}><Check /> Apply revision</button>
                  </footer>
                </section>
              </div>
            </div>
          )}

          {section === "workshop" && !selectedProposal && (
            <div className="skills-workshop">
              <header className="skills-page-heading">
                <div><span>Skill Workshop</span><h1>Teach the workspace safely.</h1><p>Draft, scan, evaluate, and apply. Only apply changes the live library.</p></div>
                {canManage && onPropose && <div className="skills-page-heading__actions"><button type="button" className="is-primary" onClick={() => { setProposalTarget(undefined); setComposerOpen(true); }}><Plus /> New proposal</button></div>}
              </header>
              <div className="skills-list-empty skills-section-empty"><Wrench /><strong>No Workshop proposals</strong><span>New proposals will appear here before they can change a live skill.</span></div>
            </div>
          )}

          {section === "discover" && selectedHub && (
            <div className="skills-discover">
              <header className="skills-discover-hero">
                <div className="skills-discover-hero__art"><Globe2 /><Sparkles /><Blocks /></div>
                <div><span>ClawHub</span><h1>Find a sharper way to work.</h1><p>Inspect instructions, requirements, publisher, and the exact version before it joins your workspace.</p></div>
                <label><Search /><span className="skills-sr-only">Search ClawHub</span><input value={hubQuery} onChange={(event) => setHubQuery(event.target.value)} placeholder="Search skills, tools, or outcomes…" /></label>
              </header>
              <div className="skills-discover-body">
                <div className="skills-hub-results">
                  <header><div><strong>{visibleHubResults.length} registry results</strong><span>Live from ClawHub through OpenClaw</span></div></header>
                  <div className="skills-hub-grid">
                    {visibleHubResults.map((result) => {
                      const SecurityIcon = securityIcon(result.security);
                      return (
                        <button key={result.id} type="button" className={`skill-hub-card is-${result.accent}${selectedHub.id === result.id ? " is-selected" : ""}`} aria-label={result.name} onClick={() => { setSelectedHubId(result.id); void Promise.resolve(onSelectHub?.(result)).catch(() => undefined); }}>
                          <span className="skill-hub-card__mark">{result.emoji}</span>
                          <span className="skill-hub-card__title"><strong>{result.name}</strong><small>{result.owner}{result.official && <BadgeCheck aria-label="Official publisher" />}</small></span>
                          <p>{result.description}</p>
                          <span className="skill-hub-card__tags">{result.tags.slice(0, 2).map((tag) => <em key={tag}>{tag}</em>)}</span>
                          <span className={`skill-hub-card__security is-${result.security}`}><SecurityIcon />{result.official ? "Official publisher" : result.security === "passed" ? "Scan passed" : result.security === "warning" ? "Review warning" : "Not scanned"}</span>
                          <span className="skill-hub-card__version">v{result.version}<ChevronRight /></span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <aside className={`skill-hub-detail is-${selectedHub.accent}`} aria-label={`${selectedHub.name} ClawHub details`}>
                  <header><span>{selectedHub.emoji}</span><div><small>{selectedHub.slug}</small><h2>{selectedHub.name}</h2><p>{selectedHub.owner}{selectedHub.official ? " · Official" : " · Third-party"}</p></div></header>
                  <p className="skill-hub-detail__summary">{selectedHub.description}</p>
                  <div className={`skill-hub-verdict is-${selectedHub.security}`}>
                    {(() => { const Icon = securityIcon(selectedHub.security); return <Icon />; })()}
                    <div><strong>{selectedHub.official ? "Official publisher" : selectedHub.security === "passed" ? "Security scan passed" : selectedHub.security === "warning" ? "Review before install" : "No ClawHub scan"}</strong><span>{selectedHub.securityNote}</span></div>
                  </div>
                  <dl className="skill-hub-meta">
                    <div><dt>Version</dt><dd>{selectedHub.version}</dd></div>
                    <div><dt>Updated</dt><dd>{selectedHub.updated.replace("Updated ", "")}</dd></div>
                    <div><dt>Requires</dt><dd>{selectedHub.requirements}</dd></div>
                    <div><dt>Install ref</dt><dd><code>{selectedHub.installRef}</code></dd></div>
                  </dl>
                  <section><span>What changed</span><p>{selectedHub.changelog}</p></section>
                  <section><span>Install to</span><div className="skill-install-target"><button type="button" aria-pressed={installTarget === "workspace"} onClick={() => setInstallTarget("workspace")}><Users /><span><strong>{workspaceName}</strong><small>Shared main-agent workspace</small></span></button>{allowPersonalInstall && <button type="button" aria-pressed={installTarget === "personal"} onClick={() => setInstallTarget("personal")}><LockKeyhole /><span><strong>Personal</strong><small>Only your agents</small></span></button>}</div></section>
                  {!selectedHub.official && <p className="skill-hub-detail__caution"><ShieldAlert /> Third-party skills are untrusted instructions. Inspect the files before installing.</p>}
                  <footer><button type="button" disabled={selectedHub.installOnly} onClick={() => void Promise.resolve(onSelectHub?.(selectedHub)).catch(() => undefined)}><FileText /> {selectedHub.installOnly ? "Install-only source" : "Refresh details"}</button><button type="button" className="is-install" disabled={!canManage || !onInstall || busy} onClick={() => void install(selectedHub)}><CloudDownload /> {canManage ? `Install ${selectedHub.version}` : "Admin access required"}</button></footer>
                </aside>
              </div>
            </div>
          )}

          {section === "discover" && !selectedHub && (
            <div className="skills-discover">
              <header className="skills-discover-hero">
                <div className="skills-discover-hero__art"><Globe2 /><Sparkles /><Blocks /></div>
                <div><span>ClawHub</span><h1>Find a sharper way to work.</h1><p>Search the live registry, then inspect the publisher and exact version before it joins your workspace.</p></div>
                <label><Search /><span className="skills-sr-only">Search ClawHub</span><input value={hubQuery} onChange={(event) => setHubQuery(event.target.value)} placeholder="Search skills, tools, or outcomes…" /></label>
              </header>
              <div className="skills-list-empty skills-section-empty"><PackageSearch /><strong>{hubQuery ? "No matching ClawHub skills" : "Search ClawHub"}</strong><span>{hubQuery ? "Try a broader capability or outcome." : "Enter a capability or outcome to browse the live registry."}</span></div>
            </div>
          )}
        </main>
      </div>

      {notice && <div className="skills-notice" role="status"><Check /><span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice(undefined)}><X /></button></div>}

      {composerOpen && canManage && onPropose && (
        <div className="skill-composer-layer">
          <button type="button" className="skill-composer-scrim" aria-label="Close skill proposal" onClick={() => setComposerOpen(false)} />
          <aside className="skill-composer" aria-label={proposalTarget ? `Update ${proposalTarget.name}` : "New skill proposal"}>
            <header><div className="skill-composer__mark"><Sparkles /></div><div><span>Skill Workshop</span><h2>{proposalTarget ? `Propose changes to ${proposalTarget.name}` : "Propose a new skill"}</h2><p>Creates a reviewable draft. It will not change the live library.</p></div><button type="button" aria-label="Close skill proposal" onClick={() => setComposerOpen(false)}><X /></button></header>
            <form key={proposalTarget?.id ?? "new-skill"} onSubmit={submitProposal}>
              <section>
                <div className="skill-form-heading"><span>01</span><div><strong>Name the capability</strong><small>Keep the trigger short and the outcome specific.</small></div></div>
                <label><span>Name</span><input name="name" required readOnly={Boolean(proposalTarget)} defaultValue={proposalTarget?.name ?? "Customer handoff"} /></label>
                <label><span>Description</span><textarea name="description" required rows={2} defaultValue={proposalTarget?.description ?? "Turn solved customer work into a concise engineering handoff."} /></label>
                <label><span>Why this belongs</span><textarea name="goal" required rows={2} defaultValue={proposalTarget ? `Improve ${proposalTarget.name} using recent workspace evidence without rewriting its live revision.` : "The team repeats this evidence and ownership structure across support sessions."} /></label>
              </section>
              <section>
                <div className="skill-form-heading"><span>02</span><div><strong>Draft the instructions</strong><small>The scanner evaluates this content and all support files.</small></div></div>
                <label><span>SKILL.md body</span><textarea className="is-code" name="instructions" required rows={9} defaultValue={proposalTarget?.instructions ?? `# Customer handoff\n\nCapture the impact, shortest reproduction, observed evidence, workaround, and named owner.\n\nNever include customer secrets or credentials.`} /></label>
              </section>
              <section>
                <div className="skill-form-heading"><span>03</span><div><strong>Confirm the target</strong><small>OpenClaw Workshop proposals are applied only to the main agent workspace.</small></div></div>
                <div className="skill-form-choice"><label><input type="radio" name="scope" value="workspace" defaultChecked /><span><Folder /><strong>{workspaceName}</strong><small>Shared main-agent workspace</small></span></label></div>
                <input type="hidden" name="userInvocable" value="on" /><input type="hidden" name="modelInvocable" value="on" />
              </section>
              <footer><p><ShieldCheck /> Draft → scan → evaluate → apply</p><button type="button" onClick={() => setComposerOpen(false)}>Cancel</button><button type="submit" disabled={busy}><Upload /> {busy ? "Submitting…" : proposalTarget ? "Propose update" : "Create proposal"}</button></footer>
            </form>
          </aside>
        </div>
      )}
    </div>
  );
}

function SkillOverview({ skill, onShare }: { skill: SkillRecord; onShare?: () => void }) {
  return (
    <div className="skill-overview">
      <section className="skill-overview__readiness">
        <header className="skill-card-heading"><div><span>Eligibility</span><h2>{skill.eligibility === "eligible" ? "Ready for this agent" : STATUS_COPY[skill.eligibility]}</h2><p>{skill.eligibilityNote}</p></div>{skill.eligibility === "eligible" ? <CircleCheck /> : <CircleAlert />}</header>
        <div className="skill-requirements">
          {skill.requirements.map((requirement) => {
            const Icon = REQUIREMENT_ICONS[requirement.kind];
            return <div key={`${requirement.kind}-${requirement.label}`} className={`is-${requirement.state}`}><Icon /><span><small>{requirement.label}</small><strong>{requirement.value}</strong></span>{requirement.state === "met" ? <Check /> : requirement.state === "missing" ? <CircleAlert /> : <CircleDot />}</div>;
          })}
        </div>
      </section>
      <section className="skill-overview__invocation">
        <header className="skill-card-heading"><div><span>Invocation</span><h2>How the skill enters a turn</h2><p>Explicit and model-driven access are controlled separately.</p></div><Zap /></header>
        <div className="skill-invocation-command"><code>{skill.command ?? `$${skill.key.replaceAll("-", "_")}`}</code><button type="button" onClick={() => void navigator.clipboard?.writeText(skill.command ?? `$${skill.key.replaceAll("-", "_")}`)}>Copy</button></div>
        <dl className="skill-overview-list">
          <div><dt>User-invocable</dt><dd className={skill.userInvocable ? "is-on" : ""}>{skill.userInvocable ? "Slash command visible" : "Hidden"}</dd></div>
          <div><dt>Model invocation</dt><dd className={skill.modelInvocable ? "is-on" : ""}>{skill.modelInvocable ? "Eligible for selection" : "Explicit only"}</dd></div>
          {skill.directTool && <div><dt>Direct dispatch</dt><dd><code>{skill.directTool}</code></dd></div>}
          <div><dt>Recent use</dt><dd>{skill.useCount} turns · {skill.lastUsed}</dd></div>
        </dl>
      </section>
      <section className="skill-overview__source">
        <header className="skill-card-heading"><div><span>Source & precedence</span><h2>{SOURCE_LABELS[skill.source]}</h2><p>The highest-precedence eligible skill with this name becomes effective.</p></div><Blocks /></header>
        <div className="skill-source-path"><Folder /><code>{skill.path}</code></div>
        {skill.overrides && <div className="skill-override"><CircleCheck /><span><strong>Workspace version wins</strong><small>Overrides {skill.overrides}</small></span></div>}
        {skill.node && <div className="skill-override is-node"><Bot /><span><strong>Node locator</strong><small>{skill.node}</small></span></div>}
        <div className="skill-precedence" aria-label="Skill precedence"><span className={skill.source === "workspace" ? "is-active" : ""}>Workspace</span><i /><span className={skill.source === "project" ? "is-active" : ""}>Project</span><i /><span className={skill.source === "personal" ? "is-active" : ""}>Personal</span><i /><span className={skill.source === "managed" || skill.source === "bundled" || skill.source === "plugin" ? "is-active" : ""}>System</span></div>
      </section>
      <section className="skill-overview__access">
        <header className="skill-card-heading"><div><span>People & agents</span><h2>{skill.scope === "team" ? "Shared with the team" : skill.scope === "personal" ? "Personal library" : `${skill.scope[0].toUpperCase()}${skill.scope.slice(1)} scope`}</h2><p>Agent allowlists remain the final visibility override.</p></div><Users /></header>
        <div className="skill-agent-chips">{skill.agents.map((agent, index) => <span key={agent} className={`is-${(["cyan", "pink", "violet", "amber"] as const)[index % 4]}`}><Bot />{agent}</span>)}</div>
        {skill.writable && onShare && <button type="button" className="skill-share-button" onClick={onShare}>{skill.shared ? <LockKeyhole /> : <Users />}{skill.shared ? "Move to personal" : "Share with team"}</button>}
      </section>
      <section className="skill-overview__session">
        <div><History /><span><strong>Session snapshot</strong><small>New sessions select eligible revisions; this conversation keeps its pinned revision until refreshed.</small></span></div>
        <code>{skill.revisions.find((revision) => revision.active)?.label ?? "file-backed"}</code>
      </section>
    </div>
  );
}

function SkillInstructions({ skill }: { skill: SkillRecord }) {
  return (
    <div className="skill-instructions">
      <aside aria-label="Skill files">
        <header><Folder /><span><strong>{skill.key}</strong><small>{skill.files.length} files · {skill.source}</small></span></header>
        {skill.files.map((file) => <button key={file.name} type="button" aria-current={file.kind === "instruction" ? "page" : undefined}>{file.kind === "script" ? <FileCode2 /> : <FileText />}<span><strong>{file.name}</strong><small>{file.size}</small></span></button>)}
        <footer>{skill.files.length > 1 ? `${skill.files.length} files included in the bundle` : "Single-file skill"}</footer>
      </aside>
      <section>
        <header><div><span>Skill card</span><strong>SKILL.md</strong></div><div><code>{skill.path}</code>{skill.writable ? <em>Workshop-managed</em> : <em>Read only</em>}</div></header>
        <pre>{skill.instructions}</pre>
        <footer><ShieldCheck /> Skill files contain instructions, not credential values.</footer>
      </section>
    </div>
  );
}

function SkillRevisions({ skill, onRollback }: { skill: SkillRecord; onRollback: (revision: SkillRevision) => void }) {
  if (skill.revisions.length === 0) {
    return <div className="skill-revisions-empty"><History /><h2>No managed revision history</h2><p>{skill.source === "workspace" ? "This file-backed skill refreshes through the watcher. Move edits through Workshop to create immutable revisions." : "Bundled, plugin, and node-hosted skills are updated at their source."}</p></div>;
  }
  return (
    <div className="skill-revisions">
      <header><div><span>Managed history</span><h2>Immutable revisions</h2><p>Sessions pin the selected revision. Rollback creates a new current pointer; it does not rewrite history.</p></div><BadgeCheck /></header>
      <div>
        {skill.revisions.map((revision, index) => (
          <article key={revision.id} className={revision.active ? "is-active" : ""}>
            <span className="skill-revision-line"><i />{index < skill.revisions.length - 1 && <b />}</span>
            <div className="skill-revision-card">
              <header><code>{revision.label}</code>{revision.active && <em><CircleCheck /> Active</em>}<time>{revision.time}</time></header>
              <p>{revision.note}</p><footer><span>{revision.author}</span>{!revision.active && <button type="button" onClick={() => onRollback(revision)}><RotateCcw /> Roll back</button>}</footer>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
