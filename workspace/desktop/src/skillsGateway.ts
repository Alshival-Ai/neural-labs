import type {
  ClawHubResult,
  SkillAccent,
  SkillEligibility,
  SkillProposal,
  SkillRecord,
  SkillRequirement,
  SkillSource,
} from "./SkillsApp";

type RecordValue = Record<string, unknown>;

export type SkillsSnapshot = {
  skills: SkillRecord[];
  proposals: SkillProposal[];
  clawHubResults: ClawHubResult[];
};

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function accentFor(value: string): SkillAccent {
  const accents: SkillAccent[] = ["cyan", "violet", "pink", "coral", "amber", "mint"];
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return accents[Math.abs(hash) % accents.length];
}

function sourceFor(value: unknown): SkillSource {
  const source = stringValue(value) ?? "";
  if (source === "openclaw-workspace") return "workspace";
  if (source === "agents-skills-project") return "project";
  if (source === "agents-skills-personal") return "personal";
  if (source === "openclaw-managed") return "managed";
  if (source === "openclaw-bundled" || source === "openclaw-custodian") return "bundled";
  if (source === "openclaw-node") return "node";
  return "plugin";
}

function sourceOwner(source: SkillSource): string {
  if (source === "bundled") return "OpenClaw";
  if (source === "managed") return "Shared OpenClaw state";
  if (source === "workspace" || source === "project") return "Workspace team";
  if (source === "personal") return "Personal agent library";
  if (source === "node") return "Paired node";
  return "Plugin or configured source";
}

function missingSet(container: RecordValue, key: string): Set<string> {
  return new Set(stringArray(container[key]));
}

function requirementsFor(row: RecordValue): SkillRequirement[] {
  const required = isRecord(row.requirements) ? row.requirements : {};
  const missing = isRecord(row.missing) ? row.missing : {};
  const result: SkillRequirement[] = [];
  const add = (kind: SkillRequirement["kind"], label: string, values: string[], missingValues: Set<string>) => {
    for (const value of values) result.push({ kind, label, value, state: missingValues.has(value) ? "missing" : "met" });
  };
  add("os", "Operating system", stringArray(required.os), missingSet(missing, "os"));
  add("binary", "Required binary", stringArray(required.bins), missingSet(missing, "bins"));
  add("binary", "Any available binary", stringArray(required.anyBins), missingSet(missing, "anyBins"));
  add("environment", "Environment", stringArray(required.env), missingSet(missing, "env"));
  add("config", "OpenClaw configuration", stringArray(required.config), missingSet(missing, "config"));
  if (sourceFor(row.source) === "node") {
    result.push({ kind: "node", label: "Paired node", value: stringValue(row.node) ?? "Remote node", state: row.eligible === true ? "met" : "missing" });
  }
  return result;
}

function eligibilityFor(row: RecordValue, source: SkillSource): SkillEligibility {
  if (row.disabled === true) return "disabled";
  if (row.blockedByAllowlist === true || row.blockedByAgentFilter === true) return "shadowed";
  if (source === "node" && row.eligible !== true) return "offline";
  return row.eligible === true ? "eligible" : "needs-setup";
}

function eligibilityNote(row: RecordValue, eligibility: SkillEligibility, requirements: SkillRequirement[]): string {
  if (eligibility === "eligible") return "All OpenClaw requirements are available to the main agent.";
  if (eligibility === "disabled") return "Disabled in the OpenClaw skill configuration.";
  if (eligibility === "shadowed") return row.blockedByAgentFilter === true
    ? "The main agent allowlist does not include this skill."
    : "The configured bundled-skill allowlist excludes this skill.";
  if (eligibility === "offline") return "The node-hosted skill is unavailable while its paired node is offline.";
  const missing = requirements.filter((requirement) => requirement.state === "missing").map((requirement) => requirement.value);
  return missing.length ? `Missing ${missing.join(", ")}.` : "One or more OpenClaw eligibility checks need attention.";
}

function relativeDate(value: number | string | undefined): string {
  const timestamp = typeof value === "number" ? value : value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) return "Unknown";
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.max(1, Math.round(elapsed / 60_000))} min ago`;
  if (elapsed < 86_400_000) return `${Math.max(1, Math.round(elapsed / 3_600_000))} hr ago`;
  if (elapsed < 604_800_000) return `${Math.max(1, Math.round(elapsed / 86_400_000))} days ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

export function mapSkillsStatus(status: unknown, curator: unknown, proposals: unknown): SkillRecord[] {
  const statusRecord = isRecord(status) ? status : {};
  const curatorRecord = isRecord(curator) ? curator : {};
  const usageRows = Array.isArray(curatorRecord.skills) ? curatorRecord.skills : [];
  const usageByKey = new Map<string, RecordValue>();
  for (const candidate of usageRows) if (isRecord(candidate) && stringValue(candidate.skillKey)) usageByKey.set(stringValue(candidate.skillKey)!, candidate);
  const proposalRows = isRecord(proposals) && Array.isArray(proposals.proposals) ? proposals.proposals : [];
  const workshopOwned = new Set(proposalRows.flatMap((candidate): string[] => {
    if (!isRecord(candidate) || candidate.kind !== "create" || candidate.status !== "applied") return [];
    const key = stringValue(candidate.skillKey);
    return key ? [key] : [];
  }));
  const rows = Array.isArray(statusRecord.skills) ? statusRecord.skills : [];
  return rows.flatMap((candidate, index): SkillRecord[] => {
    if (!isRecord(candidate)) return [];
    const key = stringValue(candidate.skillKey) ?? stringValue(candidate.name);
    if (!key) return [];
    const source = sourceFor(candidate.source);
    const eligibility = eligibilityFor(candidate, source);
    const requirements = requirementsFor(candidate);
    const usage = usageByKey.get(key);
    const path = stringValue(candidate.filePath) ?? stringValue(candidate.baseDir) ?? key;
    const owned = workshopOwned.has(key);
    const scope: SkillRecord["scope"] = source === "workspace" || source === "project" ? "workspace"
      : source === "personal" || source === "node" ? "personal"
      : source === "managed" ? "team" : "system";
    return [{
      id: key,
      key,
      name: stringValue(candidate.name) ?? key,
      description: stringValue(candidate.description) ?? "OpenClaw skill",
      emoji: stringValue(candidate.emoji) ?? ["✦", "◎", "◇", "◌", "✺", "⌁"][index % 6],
      accent: accentFor(key),
      source,
      scope,
      owner: sourceOwner(source),
      path,
      enabled: candidate.disabled !== true,
      eligibility,
      eligibilityNote: eligibilityNote(candidate, eligibility, requirements),
      userInvocable: candidate.userInvocable !== false,
      modelInvocable: candidate.modelVisible === true,
      command: candidate.commandVisible === true || candidate.userInvocable !== false ? `$${key.replaceAll("-", "_")}` : undefined,
      writable: owned,
      workshopOwned: owned,
      shared: scope === "workspace" || scope === "team" || scope === "system",
      node: source === "node" ? stringValue(candidate.node) ?? "Paired OpenClaw node" : undefined,
      agents: [stringValue(statusRecord.agentId) ?? "main"],
      useCount: numberValue(usage?.useCount) ?? 0,
      lastUsed: usage?.lastUsedAtMs === null ? "Never" : relativeDate(numberValue(usage?.lastUsedAtMs)),
      requirements,
      files: [{ name: "SKILL.md", size: "Load card", kind: "instruction" }],
      revisions: [],
      instructions: "Select this skill to load its current OpenClaw Skill Card.",
    }];
  });
}

export function mergeSkillCard(skill: SkillRecord, payload: unknown): SkillRecord {
  if (!isRecord(payload)) return skill;
  const content = stringValue(payload.content);
  return {
    ...skill,
    path: stringValue(payload.path) ?? skill.path,
    instructions: content ?? skill.instructions,
    files: [{ name: "SKILL.md", size: numberValue(payload.sizeBytes) === undefined ? "Live" : formatBytes(numberValue(payload.sizeBytes)!), kind: "instruction" }],
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
}

export function mapSkillProposals(payload: unknown): SkillProposal[] {
  const rows = isRecord(payload) && Array.isArray(payload.proposals) ? payload.proposals : [];
  return rows.flatMap((candidate): SkillProposal[] => {
    if (!isRecord(candidate)) return [];
    const id = stringValue(candidate.id);
    const status = candidate.status;
    if (!id || !["pending", "stale", "applied", "rejected", "quarantined"].includes(String(status))) return [];
    const scanState = stringValue(candidate.scanState);
    return [{
      id,
      title: stringValue(candidate.title) ?? "Skill proposal",
      kind: candidate.kind === "update" ? "update" : "create",
      status: status as SkillProposal["status"],
      target: stringValue(candidate.skillKey) ?? stringValue(candidate.skillName) ?? "skill",
      author: "OpenClaw Workshop",
      updated: relativeDate(stringValue(candidate.updatedAt)),
      goal: stringValue(candidate.description) ?? "Open the proposal to inspect its recorded goal.",
      evidence: "Select this proposal to load its live evidence and exact revision.",
      scanner: {
        decision: scanState === "failed" || scanState === "quarantined" ? "blocked" : scanState === "clean" ? "pass" : "warning",
        critical: scanState === "failed" ? 1 : 0,
        warnings: scanState === "pending" ? 1 : 0,
        summary: scanState === "clean" ? "The built-in proposal scan is clean." : `OpenClaw scan state: ${scanState ?? "pending"}.`,
      },
      draftHash: "Loading…",
      supportFiles: [],
      instructions: "Select this proposal to load its exact PROPOSAL.md revision.",
    }];
  });
}

export function mergeProposalInspection(proposal: SkillProposal, payload: unknown): SkillProposal {
  if (!isRecord(payload) || !isRecord(payload.record)) return proposal;
  const record = payload.record;
  const scan = isRecord(record.scan) ? record.scan : {};
  const evaluation = isRecord(record.evaluation) && Array.isArray(record.evaluation.outcomes) ? record.evaluation.outcomes : [];
  const decisions = evaluation.flatMap((outcome): string[] => isRecord(outcome) && isRecord(outcome.result) && stringValue(outcome.result.decision) ? [stringValue(outcome.result.decision)!] : []);
  const decision = numberValue(scan.critical) && numberValue(scan.critical)! > 0 || decisions.includes("block") ? "blocked"
    : numberValue(scan.warn) && numberValue(scan.warn)! > 0 || decisions.includes("revise") ? "warning" : "pass";
  const findings = Array.isArray(scan.findings) ? scan.findings : [];
  const findingSummary = findings.flatMap((finding): string[] => isRecord(finding) && stringValue(finding.message) ? [stringValue(finding.message)!] : []).slice(0, 3).join(" ");
  const supportFiles = Array.isArray(payload.supportFiles) ? payload.supportFiles : [];
  return {
    ...proposal,
    title: stringValue(record.title) ?? proposal.title,
    status: ["pending", "stale", "applied", "rejected", "quarantined"].includes(String(record.status)) ? record.status as SkillProposal["status"] : proposal.status,
    target: isRecord(record.target) ? stringValue(record.target.skillKey) ?? proposal.target : proposal.target,
    updated: relativeDate(stringValue(record.updatedAt)),
    goal: stringValue(record.goal) ?? proposal.goal,
    evidence: stringValue(record.evidence) ?? proposal.evidence,
    scanner: {
      decision,
      critical: numberValue(scan.critical) ?? 0,
      warnings: numberValue(scan.warn) ?? 0,
      summary: findingSummary || (decision === "pass" ? "No blocking findings were reported for this exact revision." : "Review the recorded findings before continuing."),
    },
    draftHash: stringValue(record.draftHash)?.slice(0, 12) ?? proposal.draftHash,
    revisionHash: stringValue(payload.revisionHash),
    targetHash: isRecord(record.target) ? stringValue(record.target.currentContentHash)?.slice(0, 12) : undefined,
    supportFiles: supportFiles.flatMap((file): string[] => isRecord(file) && stringValue(file.path) ? [stringValue(file.path)!] : []),
    instructions: stringValue(payload.content) ?? proposal.instructions,
  };
}

export function mapSkillSearch(payload: unknown): ClawHubResult[] {
  const rows = isRecord(payload) && Array.isArray(payload.results) ? payload.results : [];
  return rows.flatMap((candidate): ClawHubResult[] => {
    if (!isRecord(candidate)) return [];
    const slug = stringValue(candidate.slug);
    const installRef = stringValue(candidate.installRef);
    if (!slug || !installRef) return [];
    const owner = slug.includes("/") ? slug.split("/")[0] : "ClawHub";
    const unscanned = candidate.trustState === "not-scanned-by-clawhub";
    return [{
      id: installRef,
      slug,
      installRef,
      name: stringValue(candidate.displayName) ?? slug,
      description: stringValue(candidate.summary) ?? "ClawHub skill",
      emoji: stringValue(candidate.icon) ?? "✦",
      accent: accentFor(slug),
      owner: owner.startsWith("@") ? owner : `@${owner}`,
      version: stringValue(candidate.version) ?? "latest",
      updated: numberValue(candidate.updatedAt) ? `Updated ${relativeDate(numberValue(candidate.updatedAt))}` : "Latest registry release",
      security: unscanned ? "unscanned" : "warning",
      securityNote: unscanned ? "This source is not scanned by ClawHub." : "Inspect the publisher and release before installing.",
      tags: [],
      requirements: "Open details to inspect requirements",
      changelog: "Open details to inspect the latest release notes.",
      installOnly: candidate.installOnly === true,
    }];
  });
}

export function mergeSkillDetail(result: ClawHubResult, payload: unknown): ClawHubResult {
  if (!isRecord(payload)) return result;
  const skill = isRecord(payload.skill) ? payload.skill : {};
  const owner = isRecord(payload.owner) ? payload.owner : {};
  const latest = isRecord(payload.latestVersion) ? payload.latestVersion : {};
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  const official = owner.official === true || owner.isOfficial === true || skill.isOfficial === true;
  const os = stringArray(metadata.os);
  const systems = stringArray(metadata.systems);
  const tags = isRecord(skill.tags) ? Object.keys(skill.tags) : [];
  return {
    ...result,
    name: stringValue(skill.displayName) ?? result.name,
    description: stringValue(skill.summary) ?? result.description,
    owner: stringValue(owner.displayName) ?? stringValue(owner.handle) ?? result.owner,
    official,
    version: stringValue(latest.version) ?? result.version,
    updated: numberValue(skill.updatedAt) ? `Updated ${relativeDate(numberValue(skill.updatedAt))}` : result.updated,
    security: official ? "passed" : result.security,
    securityNote: official ? "Official ClawHub publisher. OpenClaw still validates the release trust envelope before install." : result.securityNote,
    tags,
    requirements: [...os.map((value) => `OS ${value}`), ...systems].join(" · ") || "No platform requirements listed",
    changelog: stringValue(latest.changelog) ?? "No changelog was published for this release.",
  };
}
