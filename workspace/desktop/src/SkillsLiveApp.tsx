import { useCallback, useEffect, useRef, useState } from "react";

import { AutomationsApp, type AutomationDraft, type AutomationJob } from "./AutomationsApp";
import { AutomationsGateway, type AutomationsSnapshot } from "./automationsGateway";
import { BuilderWorkspace } from "./BuilderWorkspace";
import {
  builderApi, BuilderDraftConnection, hydrateBuilderDocument, readCustomSkillPackage,
  type BuilderDraft,
} from "./builderApi";
import { NeuraGateway } from "./openclaw";
import { SkillsApp, type ClawHubResult, type SkillRecord, type SkillsSection } from "./SkillsApp";
import { listCustomSkills, readSkillInstructions, setCustomSkillScope, type CustomSkill } from "./skillsApi";
import { mapSkillSearch, mapSkillsStatus, mergeSkillDetail, mergeSkillInstructions, type SkillsSnapshot } from "./skillsGateway";
import { teamChatApi, type TeamDirectoryUser } from "./teamChat";
import type { ConnectionState } from "./types";

type WorkspaceUser = { id: string; displayName: string; role: "admin" | "user" };
type Props = {
  reader: NeuraGateway;
  administrator?: AutomationsGateway;
  canManage: boolean;
  currentUser?: WorkspaceUser;
  currentUserName?: string;
  initialSection?: SkillsSection;
  sectionRequestId?: string;
  notify?: (message: string) => void;
  onComposeInNeura?: (message: string) => void;
  workspaceName?: string;
};

const EMPTY_SNAPSHOT: SkillsSnapshot = { skills: [], proposals: [], clawHubResults: [] };
const EMPTY_AUTOMATIONS: AutomationsSnapshot = { schedulerOnline: false, jobs: [] };

function customFallback(skill: CustomSkill, index: number): SkillRecord {
  const accents = ["violet", "cyan", "pink", "coral", "amber", "mint"] as const;
  return {
    id: skill.key, key: skill.key, name: skill.name, description: skill.description,
    emoji: skill.scope === "team" ? "◎" : "✦", accent: accents[index % accents.length],
    source: skill.scope === "team" ? "workspace" : "personal", scope: skill.scope,
    owner: skill.ownedByCurrentUser ? "You" : skill.ownerDisplayName, path: skill.path,
    enabled: true, eligibility: "eligible",
    eligibilityNote: skill.scope === "team" ? "Available to everyone in the workspace." : "Ready in your Neura skill picker.",
    userInvocable: true, modelInvocable: skill.scope === "team", command: `$${skill.key}`,
    writable: skill.editable, custom: true, editable: skill.editable,
    ownedByCurrentUser: skill.ownedByCurrentUser, shared: skill.scope === "team",
    agents: skill.scope === "team" || skill.ownedByCurrentUser ? ["Neura"] : [], useCount: 0,
    lastUsed: "Not yet", requirements: [], files: [{ name: "SKILL.md", size: "Saved", kind: "instruction" }],
    revisions: [], instructions: skill.instructions, instructionsState: "loaded",
  };
}

export function mergeCustomSkills(gatewaySkills: SkillRecord[], customSkills: CustomSkill[]): SkillRecord[] {
  const customByKey = new Map(customSkills.map((skill) => [skill.key, skill]));
  const merged = gatewaySkills.map((skill) => {
    const custom = customByKey.get(skill.key);
    if (!custom) return skill;
    customByKey.delete(skill.key);
    return {
      ...skill, name: custom.name, description: custom.description,
      source: custom.scope === "team" ? "workspace" as const : "personal" as const, scope: custom.scope,
      owner: custom.ownedByCurrentUser ? "You" : custom.ownerDisplayName, path: custom.path,
      command: `$${custom.key}`, modelInvocable: custom.scope === "team", writable: custom.editable,
      custom: true, editable: custom.editable, ownedByCurrentUser: custom.ownedByCurrentUser,
      shared: custom.scope === "team", agents: custom.scope === "team" || custom.ownedByCurrentUser ? ["Neura"] : [],
      instructions: custom.instructions, instructionsState: "loaded" as const, instructionsError: undefined,
    };
  });
  return [...merged, ...Array.from(customByKey.values(), customFallback)];
}

function automationInitial(job: AutomationJob): Record<string, unknown> {
  const payloadKind = ["systemEvent", "agentTurn", "command", "script"].includes(job.payload.kind) ? job.payload.kind : "agentTurn";
  const pacing = job.schedule.pacing?.split(/[–—-]/).map((value) => value.trim()) ?? [];
  return {
    name: job.name, description: job.description, scheduleKind: job.schedule.kind,
    scheduleValue: job.schedule.expression, timezone: job.schedule.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    exact: job.schedule.exact === true, triggerScript: job.schedule.trigger ?? "", pacingMin: pacing[0] ?? "", pacingMax: pacing[1] ?? "",
    payloadKind, payload: job.payload.content, workingDirectory: job.payload.workingDirectory ?? job.schedule.workingDirectory ?? "/home/node/workspace",
    sessionTarget: job.sessionTarget, wakeMode: job.wakeMode, agent: job.agent,
    deliveryMode: job.delivery.mode, channel: job.delivery.channel ?? "last", target: job.delivery.target ?? "",
    model: job.payload.model ?? "Workspace default", thinking: job.payload.thinking ?? "low",
    tools: job.payload.tools?.join(", ") ?? "", timeoutSeconds: job.payload.timeout?.replace(/\D/g, "") || "600",
    failureAlertAfter: String(Math.max(2, job.consecutiveErrors || 3)),
  };
}

function gatewayIdentity(value: unknown): { jobId?: string; configRevision?: string } {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const job = record.job && typeof record.job === "object" ? record.job as Record<string, unknown> : record;
  return { jobId: typeof job.id === "string" ? job.id : undefined, configRevision: typeof job.configRevision === "string" ? job.configRevision : undefined };
}

export function SkillsLiveApp({ reader, administrator, canManage, currentUser, currentUserName = "You", initialSection = "mine", sectionRequestId, notify, onComposeInNeura, workspaceName = "Workspace" }: Props) {
  const user = currentUser ?? { id: "current-user", displayName: currentUserName, role: canManage ? "admin" as const : "user" as const };
  const [snapshot, setSnapshot] = useState<SkillsSnapshot>(EMPTY_SNAPSHOT);
  const [automations, setAutomations] = useState<AutomationsSnapshot>(EMPTY_AUTOMATIONS);
  const [drafts, setDrafts] = useState<BuilderDraft[]>([]);
  const [directory, setDirectory] = useState<TeamDirectoryUser[]>([]);
  const [activeDraft, setActiveDraft] = useState<BuilderDraft>();
  const [builderConnection, setBuilderConnection] = useState<BuilderDraftConnection>();
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [adminConnection, setAdminConnection] = useState<ConnectionState>(canManage ? "connecting" : "disconnected");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const refreshInFlight = useRef<Promise<void> | undefined>(undefined);
  const instructionsInFlight = useRef(new Map<string, Promise<void>>());
  const connected = useRef(false);
  const hubQuery = useRef("");
  const activeConnection = useRef<BuilderDraftConnection | undefined>(undefined);

  const loadSkillInstructions = useCallback((skill: SkillRecord) => {
    if (skill.custom || skill.instructionsState === "loaded") return Promise.resolve();
    const existing = instructionsInFlight.current.get(skill.id);
    if (existing) return existing;
    setSnapshot((current) => ({ ...current, skills: current.skills.map((item) => item.id === skill.id
      ? { ...item, instructionsState: "loading", instructionsError: undefined }
      : item) }));
    const request = readSkillInstructions(skill.path)
      .then((payload) => setSnapshot((current) => ({ ...current, skills: current.skills.map((item) => item.id === skill.id ? mergeSkillInstructions(item, payload) : item) })))
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : `Could not load ${skill.name}.`;
        setSnapshot((current) => ({ ...current, skills: current.skills.map((item) => item.id === skill.id
          ? { ...item, instructionsState: "error", instructionsError: message }
          : item) }));
      })
      .finally(() => instructionsInFlight.current.delete(skill.id));
    instructionsInFlight.current.set(skill.id, request);
    return request;
  }, []);

  const loadHubDetail = useCallback(async (result: ClawHubResult) => {
    if (result.installOnly) return;
    try {
      const payload = await reader.readSkillDetail(result.slug);
      setSnapshot((current) => ({ ...current, clawHubResults: current.clawHubResults.map((item) => item.id === result.id ? mergeSkillDetail(item, payload) : item) }));
    } catch (reason) { notify?.(reason instanceof Error ? reason.message : `Could not load ${result.name} details.`); }
  }, [notify, reader]);

  const refreshAutomations = useCallback(async () => {
    const next = canManage && administrator && adminConnection === "connected" ? await administrator.snapshot() : await reader.readAutomations();
    setAutomations(next);
  }, [adminConnection, administrator, canManage, reader]);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const request = (async () => {
      const query = hubQuery.current.trim();
      const [status, curator, custom, search, draftResult, directoryResult] = await Promise.all([
        reader.readSkillsStatus(), reader.readSkillsCuratorStatus().catch(() => undefined), listCustomSkills(),
        query ? reader.searchSkills(query).catch(() => undefined) : Promise.resolve(undefined),
        builderApi.list(), teamChatApi.directory().catch(() => ({ users: [] })),
      ]);
      const next: SkillsSnapshot = { skills: mergeCustomSkills(mapSkillsStatus(status, curator, undefined), custom), proposals: [], clawHubResults: mapSkillSearch(search) };
      setSnapshot((current) => ({
        ...next,
        skills: next.skills.map((skill) => {
          const previous = current.skills.find((candidate) => candidate.id === skill.id && candidate.path === skill.path);
          if (!previous) return skill;
          return {
            ...skill,
            instructions: previous.instructions,
            instructionsState: previous.instructionsState,
            instructionsError: previous.instructionsError,
            files: previous.instructions ? previous.files : skill.files,
          };
        }),
      }));
      setDrafts(draftResult.drafts); setDirectory(directoryResult.users); setError(undefined);
      void refreshAutomations().catch(() => undefined);
    })().catch((reason: unknown) => { const message = reason instanceof Error ? reason.message : "Skills could not be loaded."; setError(message); throw reason; })
      .finally(() => { setLoading(false); refreshInFlight.current = undefined; });
    refreshInFlight.current = request;
    return request;
  }, [reader, refreshAutomations]);

  useEffect(() => {
    let eventTimer: number | undefined;
    const removeStatus = reader.onStatus((state, reason) => { connected.current = state === "connected"; setConnection(state); if (state === "connected") void refresh().catch(() => undefined); if (state === "error" && reason) { setLoading(false); setError(reason); } });
    const removeEvents = reader.onEvent((event) => { const name = event.event.toLowerCase(); if (!name.includes("skill") && !name.includes("cron")) return; window.clearTimeout(eventTimer); eventTimer = window.setTimeout(() => void refresh().catch(() => undefined), 250); });
    const interval = window.setInterval(() => { if (connected.current) void refresh().catch(() => undefined); }, 30_000);
    reader.start();
    return () => { removeStatus(); removeEvents(); window.clearTimeout(eventTimer); window.clearInterval(interval); };
  }, [reader, refresh]);

  useEffect(() => {
    if (!canManage || !administrator) return;
    const removeStatus = administrator.onStatus((state, reason) => { setAdminConnection(state); if (state === "connected") void refreshAutomations().catch(() => undefined); if (state === "error" && reason) setError(reason); });
    const removeChanged = administrator.onChanged(() => void refreshAutomations().catch(() => undefined));
    administrator.start(); return () => { removeStatus(); removeChanged(); };
  }, [administrator, canManage, refreshAutomations]);

  useEffect(() => () => activeConnection.current?.stop(), []);

  const openDraft = useCallback(async (draft: Pick<BuilderDraft, "id">) => {
    try {
      const payload = await builderApi.get(draft.id);
      activeConnection.current?.stop();
      const next = new BuilderDraftConnection(payload.draft.id, { userId: user.id, displayName: user.displayName, color: presenceColor(user.id) });
      hydrateBuilderDocument(next.doc, payload.update); next.start(); activeConnection.current = next;
      setBuilderConnection(next); setActiveDraft(payload.draft);
    } catch (reason) { notify?.(reason instanceof Error ? reason.message : "The draft could not be opened."); }
  }, [notify, user.displayName, user.id]);

  const createDraft = useCallback(async (kind: "skill" | "automation", initial?: Record<string, unknown>, targetKey?: string, baseRevision?: string) => {
    try { const result = await builderApi.create({ kind, initial, targetKey, baseRevision }); setDrafts((current) => [result.draft, ...current]); await openDraft(result.draft); return result.draft; }
    catch (reason) { notify?.(reason instanceof Error ? reason.message : "The draft could not be created."); }
  }, [notify, openDraft]);

  const editSkill = async (skill: SkillRecord, duplicate = false) => {
    let skillSource: string | undefined; let openAiSource: string | undefined; let packageFiles: Array<{ path: string; kind: "text" | "asset"; content?: string; data?: string }> | undefined;
    if (skill.custom) {
      const pkg = await readCustomSkillPackage(skill.key).catch(() => undefined);
      skillSource = pkg?.files.find((file) => file.path === "SKILL.md")?.content;
      openAiSource = pkg?.files.find((file) => file.path === "agents/openai.yaml")?.content;
      packageFiles = pkg?.files;
    }
    const supportingFiles = packageFiles?.filter((file) => file.kind === "text" && (!duplicate || !["SKILL.md", "agents/openai.yaml"].includes(file.path)));
    const created = await createDraft("skill", { name: duplicate ? `${skill.name} copy` : skill.name, key: duplicate ? undefined : skill.key, description: skill.description, scope: duplicate ? "personal" : skill.scope, skillSource: duplicate ? undefined : skillSource, openAiSource: duplicate ? undefined : openAiSource, instructions: skill.instructions, files: supportingFiles }, duplicate ? undefined : skill.key, duplicate ? undefined : skill.revisions[0]?.id);
    if (created) {
      for (const asset of packageFiles?.filter((file) => file.kind === "asset" && "data" in file && typeof file.data === "string") ?? []) {
        try {
          const binary = atob(asset.data!);
          const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
          await builderApi.saveAsset(created.id, asset.path, new File([bytes], asset.path.split("/").at(-1) ?? "asset", { type: "application/octet-stream" }));
        } catch (reason) {
          notify?.(reason instanceof Error ? reason.message : `${asset.path} could not be copied into the draft.`);
        }
      }
    }
  };

  const search = useCallback(async (query: string) => {
    const normalized = query.trim(); hubQuery.current = normalized;
    if (!normalized) { setSnapshot((current) => ({ ...current, clawHubResults: [] })); setError(undefined); return; }
    try { const results = mapSkillSearch(await reader.searchSkills(normalized)); setSnapshot((current) => ({ ...current, clawHubResults: results })); if (results[0]) void loadHubDetail(results[0]); setError(undefined); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "ClawHub search failed."); }
  }, [loadHubDetail, reader]);

  const share = async (skill: SkillRecord, scope: "personal" | "team") => { await setCustomSkillScope(skill.key, scope); await refresh(); notify?.(`${skill.name} is now ${scope === "team" ? "a Team Skill" : "personal"}.`); };
  const install = async (result: ClawHubResult) => { if (!canManage || !administrator || adminConnection !== "connected") throw new Error("An administrator must install OpenClaw skills for the team."); await administrator.installSkill(result); await refresh(); notify?.(`${result.name} was installed for the team.`); };
  const publishAutomation = async (draft: AutomationDraft, targetKey?: string) => {
    if (!administrator || adminConnection !== "connected") throw new Error("The administrator scheduler connection is not ready.");
    const existing = targetKey ? automations.jobs.find((job) => job.id === targetKey) : undefined;
    return gatewayIdentity(existing ? await administrator.update(existing, draft) : await administrator.create(draft));
  };

  if (activeDraft && builderConnection) return <BuilderWorkspace draft={activeDraft} connection={builderConnection} currentUser={user} directory={directory} skills={snapshot.skills} gateway={reader} onBack={() => { builderConnection.stop(); activeConnection.current = undefined; setBuilderConnection(undefined); setActiveDraft(undefined); void refresh().catch(() => undefined); }} onDraftChanged={(next) => { setActiveDraft(next); setDrafts((current) => current.map((item) => item.id === next.id ? next : item)); }} onPublished={refresh} onPublishAutomation={canManage ? publishAutomation : undefined} notify={notify} />;

  return <SkillsApp skills={snapshot.skills} clawHubResults={snapshot.clawHubResults} drafts={drafts} initialSection={initialSection} sectionRequestId={sectionRequestId} workspaceName={workspaceName} currentUserName={user.displayName} gatewayOnline={connection === "connected"} canInstallFromOpenClaw={canManage && adminConnection === "connected"} loading={loading || connection === "connecting"} error={error} onRefresh={refresh} onSelectSkill={loadSkillInstructions} onSelectHub={loadHubDetail} onDiscoverSearch={search} onInvoke={(skill) => onComposeInNeura?.(skill.command ?? `$${skill.key}`)} onShare={share} onInstall={canManage ? install : undefined} onCreateSkill={() => void createDraft("skill")} onCreateAutomation={canManage ? () => void createDraft("automation") : undefined} onOpenDraft={(draft) => void openDraft(draft)} onEditSkill={(skill) => void editSkill(skill)} onDuplicateSkill={(skill) => void editSkill(skill, true)} automationsContent={<AutomationsApp jobs={automations.jobs} workspaceName={workspaceName} schedulerOnline={automations.schedulerOnline} loading={connection !== "connected"} onRefresh={refreshAutomations} onCreateDraft={canManage ? () => void createDraft("automation") : undefined} onEditDraft={canManage ? (job) => void createDraft("automation", automationInitial(job), job.id, job.configRevision) : undefined} onToggle={canManage && administrator ? async (job, enabled) => { await administrator.toggle(job, enabled); await refreshAutomations(); } : undefined} onRun={canManage && administrator ? async (job, mode) => { await administrator.run(job, mode); await refreshAutomations(); } : undefined} onDelete={canManage && administrator ? async (job) => { await administrator.remove(job); await refreshAutomations(); } : undefined} />} />;
}

function presenceColor(value: string) {
  const colors = ["#7446e8", "#0e9a9a", "#de5f88", "#dd7b36", "#33956c", "#4f73d9"];
  let hash = 0; for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}
