import { useCallback, useEffect, useRef, useState } from "react";

import { AutomationsGateway } from "./automationsGateway";
import { NeuraGateway } from "./openclaw";
import { SkillsApp, type ClawHubResult, type SkillRecord } from "./SkillsApp";
import { createCustomSkill, listCustomSkills, setCustomSkillScope, updateCustomSkill, type CustomSkill, type CustomSkillDraft } from "./skillsApi";
import { mapSkillSearch, mapSkillsStatus, mergeSkillCard, mergeSkillDetail, type SkillsSnapshot } from "./skillsGateway";
import type { ConnectionState } from "./types";

type Props = {
  reader: NeuraGateway;
  administrator?: AutomationsGateway;
  canManage: boolean;
  currentUserName?: string;
  notify?: (message: string) => void;
  onComposeInNeura?: (message: string) => void;
  workspaceName?: string;
};

const EMPTY_SNAPSHOT: SkillsSnapshot = { skills: [], proposals: [], clawHubResults: [] };

function customFallback(skill: CustomSkill, index: number): SkillRecord {
  const accents = ["violet", "cyan", "pink", "coral", "amber", "mint"] as const;
  return {
    id: skill.key,
    key: skill.key,
    name: skill.name,
    description: skill.description,
    emoji: skill.scope === "team" ? "◎" : "✦",
    accent: accents[index % accents.length],
    source: skill.scope === "team" ? "workspace" : "personal",
    scope: skill.scope,
    owner: skill.ownedByCurrentUser ? "You" : skill.ownerDisplayName,
    path: skill.path,
    enabled: true,
    eligibility: "eligible",
    eligibilityNote: skill.scope === "team" ? "Available to everyone in the workspace." : "Ready in your Neura skill picker.",
    userInvocable: true,
    modelInvocable: skill.scope === "team",
    command: `$${skill.key.replaceAll("-", "_")}`,
    writable: skill.editable,
    custom: true,
    editable: skill.editable,
    ownedByCurrentUser: skill.ownedByCurrentUser,
    shared: skill.scope === "team",
    agents: skill.scope === "team" || skill.ownedByCurrentUser ? ["Neura"] : [],
    useCount: 0,
    lastUsed: "Not yet",
    requirements: [],
    files: [{ name: "SKILL.md", size: "Saved", kind: "instruction" }],
    revisions: [],
    instructions: skill.instructions,
  };
}

export function mergeCustomSkills(gatewaySkills: SkillRecord[], customSkills: CustomSkill[]): SkillRecord[] {
  const customByKey = new Map(customSkills.map((skill) => [skill.key, skill]));
  const merged = gatewaySkills.map((skill) => {
    const custom = customByKey.get(skill.key);
    if (!custom) return skill;
    customByKey.delete(skill.key);
    return {
      ...skill,
      name: custom.name,
      description: custom.description,
      source: custom.scope === "team" ? "workspace" as const : "personal" as const,
      scope: custom.scope,
      owner: custom.ownedByCurrentUser ? "You" : custom.ownerDisplayName,
      path: custom.path,
      modelInvocable: custom.scope === "team",
      writable: custom.editable,
      custom: true,
      editable: custom.editable,
      ownedByCurrentUser: custom.ownedByCurrentUser,
      shared: custom.scope === "team",
      agents: custom.scope === "team" || custom.ownedByCurrentUser ? ["Neura"] : [],
      instructions: custom.instructions,
    };
  });
  return [...merged, ...Array.from(customByKey.values(), customFallback)];
}

export function SkillsLiveApp({ reader, administrator, canManage, currentUserName = "You", notify, onComposeInNeura, workspaceName = "Workspace" }: Props) {
  const [snapshot, setSnapshot] = useState<SkillsSnapshot>(EMPTY_SNAPSHOT);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [adminConnection, setAdminConnection] = useState<ConnectionState>(canManage ? "connecting" : "disconnected");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const refreshInFlight = useRef<Promise<void> | undefined>(undefined);
  const connected = useRef(false);
  const hubQuery = useRef("");

  const loadSkillCard = useCallback(async (skill: SkillRecord) => {
    if (skill.custom) return;
    try {
      const payload = await reader.readSkillCard(skill.key);
      setSnapshot((current) => ({ ...current, skills: current.skills.map((item) => item.id === skill.id ? mergeSkillCard(item, payload) : item) }));
    } catch (reason) {
      notify?.(reason instanceof Error ? reason.message : `Could not load ${skill.name}.`);
    }
  }, [notify, reader]);

  const loadHubDetail = useCallback(async (result: ClawHubResult) => {
    if (result.installOnly) return;
    try {
      const payload = await reader.readSkillDetail(result.slug);
      setSnapshot((current) => ({ ...current, clawHubResults: current.clawHubResults.map((item) => item.id === result.id ? mergeSkillDetail(item, payload) : item) }));
    } catch (reason) {
      notify?.(reason instanceof Error ? reason.message : `Could not load ${result.name} details.`);
    }
  }, [notify, reader]);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const request = (async () => {
      const query = hubQuery.current.trim();
      const [status, curator, custom, search] = await Promise.all([
        reader.readSkillsStatus(),
        reader.readSkillsCuratorStatus().catch(() => undefined),
        listCustomSkills(),
        query ? reader.searchSkills(query).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      const next: SkillsSnapshot = {
        skills: mergeCustomSkills(mapSkillsStatus(status, curator, undefined), custom),
        proposals: [],
        clawHubResults: mapSkillSearch(search),
      };
      setSnapshot(next);
      setError(undefined);
      const firstSystemSkill = next.skills.find((skill) => !skill.custom);
      if (firstSystemSkill) void loadSkillCard(firstSystemSkill);
    })().catch((reason: unknown) => {
      const message = reason instanceof Error ? reason.message : "Skills could not be loaded.";
      setError(message);
      throw reason;
    }).finally(() => {
      setLoading(false);
      refreshInFlight.current = undefined;
    });
    refreshInFlight.current = request;
    return request;
  }, [loadSkillCard, reader]);

  useEffect(() => {
    let eventTimer: number | undefined;
    const removeStatus = reader.onStatus((state, reason) => {
      connected.current = state === "connected";
      setConnection(state);
      if (state === "connected") void refresh().catch(() => undefined);
      if (state === "error" && reason) { setLoading(false); setError(reason); }
    });
    const removeEvents = reader.onEvent((event) => {
      if (!event.event.toLowerCase().includes("skill")) return;
      window.clearTimeout(eventTimer);
      eventTimer = window.setTimeout(() => void refresh().catch(() => undefined), 250);
    });
    const interval = window.setInterval(() => { if (connected.current) void refresh().catch(() => undefined); }, 30_000);
    reader.start();
    return () => { removeStatus(); removeEvents(); window.clearTimeout(eventTimer); window.clearInterval(interval); };
  }, [reader, refresh]);

  useEffect(() => {
    if (!canManage || !administrator) return;
    const removeStatus = administrator.onStatus((state, reason) => { setAdminConnection(state); if (state === "error" && reason) setError(reason); });
    administrator.start();
    return () => { removeStatus(); };
  }, [administrator, canManage]);

  const search = useCallback(async (query: string) => {
    const normalized = query.trim();
    hubQuery.current = normalized;
    if (!normalized) { setSnapshot((current) => ({ ...current, clawHubResults: [] })); setError(undefined); return; }
    try {
      const results = mapSkillSearch(await reader.searchSkills(normalized));
      setSnapshot((current) => ({ ...current, clawHubResults: results }));
      if (results[0]) void loadHubDetail(results[0]);
      setError(undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "ClawHub search failed."); }
  }, [loadHubDetail, reader]);

  const save = async (draft: CustomSkillDraft, skill?: SkillRecord) => {
    if (skill) await updateCustomSkill(skill.key, draft);
    else await createCustomSkill(draft);
    await refresh();
    notify?.(`${draft.name} saved.`);
  };

  const share = async (skill: SkillRecord, scope: "personal" | "team") => {
    await setCustomSkillScope(skill.key, scope);
    await refresh();
    notify?.(`${skill.name} is now ${scope === "team" ? "a Team Skill" : "personal"}.`);
  };

  const install = async (result: ClawHubResult) => {
    if (!canManage || !administrator || adminConnection !== "connected") throw new Error("An administrator must install OpenClaw skills for the team.");
    await administrator.installSkill(result);
    await refresh();
    notify?.(`${result.name} was installed for the team.`);
  };

  return <SkillsApp
    skills={snapshot.skills}
    clawHubResults={snapshot.clawHubResults}
    workspaceName={workspaceName}
    currentUserName={currentUserName}
    gatewayOnline={connection === "connected"}
    canInstallFromOpenClaw={canManage && adminConnection === "connected"}
    loading={loading || connection === "connecting"}
    error={error}
    onRefresh={refresh}
    onSelectSkill={(skill) => {
      if (skill.scope === "system" || !skill.custom && skill.scope === "personal") {
        onComposeInNeura?.(skill.command ?? `$${skill.key.replaceAll("-", "_")}`);
        notify?.(`${skill.name} added to Neura.`);
        return;
      }
      return loadSkillCard(skill);
    }}
    onSelectHub={loadHubDetail}
    onDiscoverSearch={search}
    onInvoke={(skill) => onComposeInNeura?.(skill.command ?? `$${skill.key.replaceAll("-", "_")}`)}
    onSave={save}
    onShare={share}
    onInstall={canManage ? install : undefined}
  />;
}
