import { useCallback, useEffect, useRef, useState } from "react";

import { AutomationsGateway } from "./automationsGateway";
import { NeuraGateway } from "./openclaw";
import {
  SkillsApp,
  type ClawHubResult,
  type SkillProposal,
  type SkillProposalAction,
  type SkillProposalDraft,
  type SkillRecord,
} from "./SkillsApp";
import {
  mapSkillProposals,
  mapSkillSearch,
  mapSkillsStatus,
  mergeProposalInspection,
  mergeSkillCard,
  mergeSkillDetail,
  type SkillsSnapshot,
} from "./skillsGateway";
import type { ConnectionState } from "./types";

type Props = {
  reader: NeuraGateway;
  administrator?: AutomationsGateway;
  canManage: boolean;
  notify?: (message: string) => void;
  onComposeInNeura?: (message: string) => void;
  workspaceName?: string;
};

const EMPTY_SNAPSHOT: SkillsSnapshot = { skills: [], proposals: [], clawHubResults: [] };

export function SkillsLiveApp({ reader, administrator, canManage, notify, onComposeInNeura, workspaceName = "Workspace" }: Props) {
  const [snapshot, setSnapshot] = useState<SkillsSnapshot>(EMPTY_SNAPSHOT);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [adminConnection, setAdminConnection] = useState<ConnectionState>(canManage ? "connecting" : "disconnected");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const refreshInFlight = useRef<Promise<void> | undefined>(undefined);
  const connected = useRef(false);
  const hubQuery = useRef("");

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const request = (async () => {
      const query = hubQuery.current.trim();
      const [status, curator, proposals, search] = await Promise.all([
        reader.readSkillsStatus(),
        reader.readSkillsCuratorStatus().catch(() => undefined),
        reader.listSkillProposals().catch(() => undefined),
        query ? reader.searchSkills(query).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      const mappedProposals = mapSkillProposals(proposals);
      const next: SkillsSnapshot = {
        skills: mapSkillsStatus(status, curator, proposals),
        proposals: mappedProposals,
        clawHubResults: mapSkillSearch(search),
      };
      setSnapshot(next);
      setError(undefined);
      const firstSkill = next.skills[0];
      if (firstSkill) void loadSkillCard(firstSkill);
      const firstProposal = next.proposals[0];
      if (firstProposal) void loadProposal(firstProposal);
    })().catch((reason: unknown) => {
      const message = reason instanceof Error ? reason.message : "OpenClaw did not return the skill catalog.";
      setError(message);
      throw reason;
    }).finally(() => {
      setLoading(false);
      refreshInFlight.current = undefined;
    });
    refreshInFlight.current = request;
    return request;
  }, [reader]);

  const loadSkillCard = useCallback(async (skill: SkillRecord) => {
    try {
      const payload = await reader.readSkillCard(skill.key);
      setSnapshot((current) => ({ ...current, skills: current.skills.map((item) => item.id === skill.id ? mergeSkillCard(item, payload) : item) }));
    } catch (reason) {
      notify?.(reason instanceof Error ? reason.message : `Could not load ${skill.name}.`);
    }
  }, [notify, reader]);

  const loadProposal = useCallback(async (proposal: SkillProposal) => {
    try {
      const payload = await reader.inspectSkillProposal(proposal.id);
      setSnapshot((current) => ({ ...current, proposals: current.proposals.map((item) => item.id === proposal.id ? mergeProposalInspection(item, payload) : item) }));
    } catch (reason) {
      notify?.(reason instanceof Error ? reason.message : `Could not inspect ${proposal.title}.`);
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

  useEffect(() => {
    let eventTimer: number | undefined;
    const removeStatus = reader.onStatus((state, reason) => {
      connected.current = state === "connected";
      setConnection(state);
      if (state === "connected") void refresh().catch(() => undefined);
      if (state === "error" && reason) {
        setLoading(false);
        setError(reason);
      }
    });
    const removeEvents = reader.onEvent((event) => {
      if (!event.event.toLowerCase().includes("skill")) return;
      window.clearTimeout(eventTimer);
      eventTimer = window.setTimeout(() => void refresh().catch(() => undefined), 250);
    });
    const interval = window.setInterval(() => {
      if (connected.current) void refresh().catch(() => undefined);
    }, 30_000);
    reader.start();
    return () => {
      removeStatus();
      removeEvents();
      window.clearTimeout(eventTimer);
      window.clearInterval(interval);
    };
  }, [reader, refresh]);

  useEffect(() => {
    if (!canManage || !administrator) return;
    const removeStatus = administrator.onStatus((state, reason) => {
      setAdminConnection(state);
      if (state === "error" && reason) setError(reason);
    });
    administrator.start();
    return () => { removeStatus(); };
  }, [administrator, canManage]);

  const mutate = useCallback(async (operation: () => Promise<unknown>, success: string) => {
    if (!canManage || !administrator) throw new Error("Administrator access is required for this skill change.");
    if (adminConnection !== "connected") throw new Error("The administrator connection to OpenClaw is not ready yet.");
    try {
      await operation();
      await refresh();
      setError(undefined);
      notify?.(success);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "OpenClaw rejected the skill change.";
      setError(message);
      notify?.(message);
      throw reason;
    }
  }, [adminConnection, administrator, canManage, notify, refresh]);

  const search = useCallback(async (query: string) => {
    const normalized = query.trim();
    hubQuery.current = normalized;
    if (!normalized) {
      setSnapshot((current) => ({ ...current, clawHubResults: [] }));
      setError(undefined);
      return;
    }
    try {
      const results = mapSkillSearch(await reader.searchSkills(normalized));
      setSnapshot((current) => ({ ...current, clawHubResults: results }));
      if (results[0]) void loadHubDetail(results[0]);
      setError(undefined);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "ClawHub search failed.";
      setError(message);
    }
  }, [loadHubDetail, reader]);

  const proposalAction = async (proposal: SkillProposal, action: SkillProposalAction) => {
    if (action === "request-revision") {
      onComposeInNeura?.(`Please inspect Skill Workshop proposal ${proposal.id} (${proposal.target}) and help me revise it. Ask what I want changed before modifying the proposal.`);
      return;
    }
    await mutate(() => administrator!.actOnSkillProposal(proposal, action), `${proposal.title}: ${action} completed.`);
    await loadProposal(proposal);
  };

  const propose = (draft: SkillProposalDraft) => mutate(() => administrator!.createSkillProposal(draft), `${draft.name.trim()} was added to Skill Workshop.`);
  const install = (result: ClawHubResult, target: "workspace" | "personal") => {
    if (target !== "workspace") return Promise.reject(new Error("OpenClaw Gateway installs currently target the shared workspace."));
    return mutate(() => administrator!.installSkill(result), `${result.name} was installed into the shared workspace.`);
  };

  return (
    <SkillsApp
      skills={snapshot.skills}
      proposals={snapshot.proposals}
      clawHubResults={snapshot.clawHubResults}
      workspaceName={workspaceName}
      gatewayOnline={connection === "connected"}
      canManage={canManage && adminConnection === "connected"}
      allowPersonalInstall={false}
      loading={loading || connection === "connecting"}
      error={error}
      onRefresh={() => refresh()}
      onSelectSkill={(skill) => loadSkillCard(skill)}
      onSelectProposal={(proposal) => loadProposal(proposal)}
      onSelectHub={(result) => loadHubDetail(result)}
      onDiscoverSearch={search}
      onInvoke={(skill) => onComposeInNeura?.(skill.command ?? `$${skill.key.replaceAll("-", "_")}`)}
      onToggle={canManage ? async (skill, enabled) => {
        await mutate(() => administrator!.updateSkill(skill, enabled), `${skill.name} ${enabled ? "enabled" : "disabled"}.`);
        await loadSkillCard(skill);
      } : undefined}
      onProposalAction={canManage || onComposeInNeura ? proposalAction : undefined}
      onPropose={canManage ? propose : undefined}
      onInstall={canManage ? install : undefined}
      onScanHistory={canManage ? () => mutate(() => administrator!.scanSkillHistory(), "Earlier sessions were reviewed for reusable skill ideas.") : undefined}
    />
  );
}
